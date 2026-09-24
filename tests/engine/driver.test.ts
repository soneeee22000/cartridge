import { describe, expect, it, vi } from "vitest";
import { APICallError } from "@ai-sdk/provider";
import { MemoryArtifactStore } from "../../src/engine/artifacts/memory.ts";
import { createCartridge } from "../../src/engine/cartridge.ts";
import { manualClock, type ManualClock } from "../../src/engine/clock.ts";
import { driveRun, type DriverDeps } from "../../src/engine/driver.ts";
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_CLAIMS,
} from "../../src/engine/lifecycle.ts";
import { MemoryRunStore } from "../../src/engine/run-store/memory.ts";
import type { RunStore } from "../../src/engine/run-store/types.ts";
import {
  cartridgePort,
  type StartWorkflowStream,
  type WorkflowHandle,
} from "../../src/engine/workflow-port.ts";
import { CassetteMissError } from "../../src/models/cassette.ts";
import {
  MOCK_GAME_HTML,
  scriptedTurns,
  type Turn,
} from "../../src/models/mock.ts";
import {
  BROKEN_GAME_HTML,
  doneTurn,
  planTurn,
  saveTurn,
} from "./workflow-helpers.ts";

const RUN_ID = "run-1";

async function setup(
  maxClaims = MAX_CLAIMS,
): Promise<{ store: MemoryRunStore; clock: ManualClock }> {
  const clock = manualClock(0);
  const store = new MemoryRunStore(clock);
  await store.create({
    id: RUN_ID,
    runKey: "lantern-dash",
    prompt: "A lantern and the tiles",
    maxClaims,
  });
  return { store, clock };
}

function mockPort(builderTurns: readonly Turn[]): StartWorkflowStream {
  return cartridgePort(() =>
    createCartridge({
      models: {
        planner: scriptedTurns([planTurn()]),
        builder: scriptedTurns(builderTurns),
      },
      artifacts: new MemoryArtifactStore(),
    }),
  );
}

interface ScriptedHandle extends WorkflowHandle {
  readonly cancelled: () => boolean;
}

function handFed(
  chunks: readonly unknown[],
  options: { hang?: boolean; result?: unknown } = {},
): ScriptedHandle {
  let cancelled = false;
  async function* stream() {
    for (const chunk of chunks) {
      await Promise.resolve();
      yield chunk;
    }
    if (options.hang) await new Promise(() => undefined);
  }
  return {
    fullStream: stream(),
    result: Promise.resolve(
      options.result ?? { status: "success", result: {} },
    ),
    cancel: () => {
      cancelled = true;
      return Promise.resolve();
    },
    cancelled: () => cancelled,
  };
}

const stepStart = (id: string) => ({
  type: "workflow-step-start",
  payload: { id, status: "running" },
});

function deps(
  store: RunStore,
  clock: ManualClock,
  start: StartWorkflowStream,
  extra: Partial<DriverDeps> = {},
): DriverDeps {
  return {
    store,
    clock,
    owner: "driver-a",
    startWorkflowStream: start,
    ...extra,
  };
}

describe("driveRun (§5.4)", () => {
  it("claims, streams the mock workflow and seals a complete row", async () => {
    const { store, clock } = await setup();
    const outcome = await driveRun(
      RUN_ID,
      deps(store, clock, mockPort([saveTurn(MOCK_GAME_HTML), doneTurn])),
    );
    expect(outcome).toBe("complete");
    const row = await store.get(RUN_ID);
    expect(row).toMatchObject({
      status: "complete",
      e1Score: 1,
      spec: { slug: "lantern-dash" },
    });
    expect(row?.artifact?.html).toBe(MOCK_GAME_HTML);
    const events = await store.listEvents(RUN_ID, 0);
    expect(events[0]?.event).toEqual({
      kind: "run.claimed",
      data: { claimAttempt: 1 },
    });
    expect(
      events.some((stored) => stored.event.kind === "verify.verdict"),
    ).toBe(true);
  });

  it("does nothing when another driver holds the claim", async () => {
    const { store, clock } = await setup();
    await store.claim(RUN_ID, "driver-b", clock.now());
    const start = vi.fn<StartWorkflowStream>();
    expect(await driveRun(RUN_ID, deps(store, clock, start))).toBe(
      "not-claimed",
    );
    expect(start).not.toHaveBeenCalled();
    expect(await store.listEvents(RUN_ID, 0)).toEqual([]);
  });

  it("never completes a cut stream: released first, abandoned at MAX_CLAIMS", async () => {
    const { store, clock } = await setup();
    const cut = () => Promise.resolve(handFed([stepStart("plan")]));
    expect(await driveRun(RUN_ID, deps(store, clock, cut))).toBe("released");
    expect(await store.get(RUN_ID)).toMatchObject({
      status: "waiting",
      attribution: { code: "stream-cut", step: "driver" },
    });
    expect(await driveRun(RUN_ID, deps(store, clock, cut))).toBe("abandoned");
    expect(await store.get(RUN_ID)).toMatchObject({
      status: "abandoned",
      claims: MAX_CLAIMS,
    });
    const kinds = (await store.listEvents(RUN_ID, 0)).map(
      (stored) => stored.event.kind,
    );
    expect(kinds.filter((kind) => kind === "run.released")).toHaveLength(2);
  });

  it("abandons a deterministic rejection without retrying", async () => {
    const { store, clock } = await setup();
    const turns = Array.from({ length: 4 }, () => [
      saveTurn(BROKEN_GAME_HTML),
      doneTurn,
    ]).flat();
    expect(await driveRun(RUN_ID, deps(store, clock, mockPort(turns)))).toBe(
      "abandoned",
    );
    expect(await store.get(RUN_ID)).toMatchObject({
      status: "abandoned",
      claims: 1,
      attribution: {
        step: "generate",
        code: "contract-unmet",
        ruleIds: ["E1-13"],
      },
    });
  });

  it("releases a retryable model error back to waiting", async () => {
    const { store, clock } = await setup();
    const overloaded = new APICallError({
      message: "Overloaded",
      url: "https://example.invalid/v1/messages",
      requestBodyValues: {},
      statusCode: 529,
      isRetryable: true,
    });
    expect(
      await driveRun(
        RUN_ID,
        deps(store, clock, mockPort([{ kind: "error", error: overloaded }])),
      ),
    ).toBe("released");
    expect(await store.get(RUN_ID)).toMatchObject({
      status: "waiting",
      attribution: { code: "model-error", retryable: true },
    });
  });

  it("stops appending and never seals when the heartbeat is lost", async () => {
    const { store, clock } = await setup();
    const beginSeal = vi.spyOn(store, "beginSeal");
    let beats = 0;
    vi.spyOn(store, "heartbeat").mockImplementation(() => {
      beats += 1;
      return Promise.resolve(beats < 2);
    });
    const handle = handFed([
      stepStart("plan"),
      stepStart("build-cycle"),
      stepStart("finalize"),
      stepStart("extra"),
    ]);
    const advancing = new Proxy<RunStore>(store, {
      get(target, property) {
        if (property === "appendEvent")
          return (...args: Parameters<RunStore["appendEvent"]>) => {
            clock.advance(HEARTBEAT_INTERVAL_MS);
            return target.appendEvent(...args);
          };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function"
          ? (value.bind(target) as unknown)
          : value;
      },
    });
    const outcome = await driveRun(
      RUN_ID,
      deps(advancing, clock, () => Promise.resolve(handle)),
    );
    expect(outcome).toBe("lease-lost");
    expect(handle.cancelled()).toBe(true);
    expect(beginSeal).not.toHaveBeenCalled();
    const kinds = (await store.listEvents(RUN_ID, 0)).map(
      (stored) => stored.event.kind,
    );
    expect(kinds).toEqual(["run.claimed", "step.start"]);
    expect((await store.get(RUN_ID))?.status).toBe("active");
  });

  it("writes nothing to the row when the heartbeat timer finds the lease lost", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { store, clock } = await setup();
      vi.spyOn(store, "heartbeat").mockResolvedValue(false);
      const release = vi.spyOn(store, "release");
      const abandon = vi.spyOn(store, "abandon");
      const { promise: blocked, resolve: unblock } =
        Promise.withResolvers<undefined>();
      let cancelled = false;
      async function* stream() {
        await Promise.resolve();
        yield stepStart("plan");
        await blocked;
      }
      const handle: WorkflowHandle = {
        fullStream: stream(),
        result: Promise.resolve({ status: "success", result: {} }),
        cancel: () => {
          cancelled = true;
          unblock(undefined);
          return Promise.resolve();
        },
      };
      const running = driveRun(
        RUN_ID,
        deps(store, clock, () => Promise.resolve(handle)),
      );
      await vi.waitFor(async () => {
        expect((await store.listEvents(RUN_ID, 0)).length).toBe(2);
      });
      clock.advance(HEARTBEAT_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
      expect(await running).toBe("lease-lost");
      expect(cancelled).toBe(true);
      expect(release).not.toHaveBeenCalled();
      expect(abandon).not.toHaveBeenCalled();
      expect((await store.listEvents(RUN_ID, 0)).length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the run and releases it with stream-cut when the signal aborts", async () => {
    const { store, clock } = await setup();
    const controller = new AbortController();
    const handle = handFed([stepStart("plan")], { hang: true });
    const running = driveRun(
      RUN_ID,
      deps(store, clock, () => Promise.resolve(handle), {
        signal: controller.signal,
      }),
    );
    await vi.waitFor(async () => {
      expect((await store.listEvents(RUN_ID, 0)).length).toBe(2);
    });
    controller.abort();
    expect(await running).toBe("released");
    expect(handle.cancelled()).toBe(true);
    expect(await store.get(RUN_ID)).toMatchObject({
      status: "waiting",
      attribution: { code: "stream-cut" },
    });
  });

  it("classifies an error that escapes the workflow as engine-crashed", async () => {
    const { store, clock } = await setup();
    const failed = handFed(
      [{ type: "workflow-finish", payload: { workflowStatus: "failed" } }],
      {
        result: { status: "failed", error: new Error("step threw") },
      },
    );
    expect(
      await driveRun(
        RUN_ID,
        deps(store, clock, () => Promise.resolve(failed)),
      ),
    ).toBe("abandoned");
    expect(await store.get(RUN_ID)).toMatchObject({
      attribution: { step: "driver", code: "engine-crashed" },
    });
  });

  it("keeps a cassette miss that reaches the driver", async () => {
    const { store, clock } = await setup();
    const start = () => Promise.reject(new CassetteMissError("none recorded"));
    expect(await driveRun(RUN_ID, deps(store, clock, start))).toBe("abandoned");
    expect(await store.get(RUN_ID)).toMatchObject({
      attribution: { step: "driver", code: "cassette-miss" },
    });
  });

  it("treats a success without a branch output as engine-crashed", async () => {
    const { store, clock } = await setup();
    const empty = handFed([
      { type: "workflow-finish", payload: { workflowStatus: "success" } },
    ]);
    expect(
      await driveRun(
        RUN_ID,
        deps(store, clock, () => Promise.resolve(empty)),
      ),
    ).toBe("abandoned");
    expect(await store.get(RUN_ID)).toMatchObject({
      attribution: { code: "engine-crashed" },
    });
  });

  it("treats a nested step id in the stream as engine-crashed", async () => {
    const { store, clock } = await setup();
    const nested = handFed([stepStart("build-cycle.generate")]);
    expect(
      await driveRun(
        RUN_ID,
        deps(store, clock, () => Promise.resolve(nested)),
      ),
    ).toBe("abandoned");
    expect(await store.get(RUN_ID)).toMatchObject({
      attribution: { code: "engine-crashed" },
    });
  });
});
