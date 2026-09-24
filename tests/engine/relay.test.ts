import { describe, expect, it } from "vitest";
import { driverAttribution } from "../../src/engine/attribution.ts";
import { manualClock, type ManualClock } from "../../src/engine/clock.ts";
import {
  lastEventIdOf,
  relayRun,
  type RelayOptions,
} from "../../src/engine/relay.ts";
import { MemoryRunStore } from "../../src/engine/run-store/memory.ts";
import { MOCK_SPEC } from "../../src/models/mock.ts";

const RUN_ID = "run-1";
const ARTIFACT = {
  version: "a0",
  sha256: "c".repeat(64),
  bytes: 6,
  html: "<html>",
};

interface SseMessage {
  readonly id?: string;
  readonly event?: string;
  readonly data?: string;
  readonly comment?: string;
}

function parseSse(text: string): SseMessage[] {
  return text
    .split("\n\n")
    .filter((block) => block.length > 0)
    .map((block) => {
      const message: Record<string, string> = {};
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) message.comment = line.slice(1).trim();
        const colon = line.indexOf(": ");
        if (!line.startsWith(":") && colon > 0)
          message[line.slice(0, colon)] = line.slice(colon + 2);
      }
      return message;
    });
}

async function setup(): Promise<{ store: MemoryRunStore; clock: ManualClock }> {
  const clock = manualClock(0);
  const store = new MemoryRunStore(clock);
  await store.create({
    id: RUN_ID,
    runKey: "lantern-dash",
    prompt: "p",
    maxClaims: 2,
  });
  await store.claim(RUN_ID, "driver-a", clock.now());
  await store.appendEvent(RUN_ID, {
    kind: "run.claimed",
    data: { claimAttempt: 1 },
  });
  await store.appendEvent(RUN_ID, {
    kind: "step.start",
    data: { step: "plan" },
  });
  await store.appendEvent(RUN_ID, {
    kind: "step.result",
    data: { step: "plan", status: "success" },
  });
  return { store, clock };
}

async function complete(
  store: MemoryRunStore,
  clock: ManualClock,
): Promise<void> {
  await store.beginSeal(RUN_ID, "driver-a", clock.now());
  await store.completeSeal(RUN_ID, "driver-a", {
    spec: MOCK_SPEC,
    artifact: ARTIFACT,
    e1Score: 0.95,
  });
}

function options(
  store: MemoryRunStore,
  clock: ManualClock,
  extra: Partial<RelayOptions> = {},
): RelayOptions {
  return {
    store,
    runId: RUN_ID,
    lastEventId: null,
    clock,
    sleep: (ms) => {
      clock.advance(ms);
      return Promise.resolve();
    },
    ...extra,
  };
}

describe("SSE relay (§6.2)", () => {
  it("gives a late client the full log plus a terminal event built from the row", async () => {
    const { store, clock } = await setup();
    await complete(store, clock);
    const response = await relayRun(options(store, clock));
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const messages = parseSse(await response.text());
    expect(messages.map((message) => message.id)).toEqual(["1", "2", "3", "4"]);
    expect(
      messages.slice(0, 3).every((message) => message.event === "progress"),
    ).toBe(true);
    const terminal = messages[3];
    expect(terminal?.event).toBe("terminal");
    expect(JSON.parse(terminal?.data ?? "")).toEqual({
      status: "complete",
      artifact: { version: "a0", sha256: ARTIFACT.sha256, html: "<html>" },
      e1Score: 0.95,
    });
  });

  it("re-attaches after Last-Event-ID or ?after= without duplicates", async () => {
    const { store, clock } = await setup();
    await complete(store, clock);
    const byHeader = parseSse(
      await (await relayRun(options(store, clock, { lastEventId: 2 }))).text(),
    );
    expect(byHeader.map((message) => message.id)).toEqual(["3", "4"]);
    const request = new Request("http://localhost/runs/run-1/events?after=1");
    expect(lastEventIdOf(request)).toBe(1);
    const withHeader = new Request("http://localhost/x", {
      headers: { "last-event-id": "3" },
    });
    expect(lastEventIdOf(withHeader)).toBe(3);
    expect(
      lastEventIdOf(new Request("http://localhost/x?after=abc")),
    ).toBeNull();
  });

  it("answers 204 with no body once Last-Event-ID reaches the terminal id", async () => {
    const { store, clock } = await setup();
    await complete(store, clock);
    const response = await relayRun(options(store, clock, { lastEventId: 4 }));
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("builds an abandoned terminal with the attribution from the row", async () => {
    const { store, clock } = await setup();
    const crash = driverAttribution("engine-crashed", "bug");
    await store.abandon(RUN_ID, "driver-a", crash);
    const messages = parseSse(
      await (await relayRun(options(store, clock))).text(),
    );
    expect(JSON.parse(messages.at(-1)?.data ?? "")).toEqual({
      status: "abandoned",
      attribution: crash,
    });
  });

  it("tails live events and ends when the row turns terminal", async () => {
    const { store, clock } = await setup();
    let polls = 0;
    const response = await relayRun(
      options(store, clock, {
        sleep: async (ms) => {
          clock.advance(ms);
          polls += 1;
          if (polls === 1)
            await store.appendEvent(RUN_ID, {
              kind: "step.start",
              data: { step: "build-cycle" },
            });
          if (polls === 2) await complete(store, clock);
        },
      }),
    );
    const messages = parseSse(await response.text());
    expect(messages.map((message) => message.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    expect(messages.at(-1)?.event).toBe("terminal");
  });

  it("sends heartbeats and asks the client to reconnect before the budget", async () => {
    const { store, clock } = await setup();
    const response = await relayRun(
      options(store, clock, {
        pollMs: 200,
        heartbeatMs: 1_000,
        budgetMs: 3_000,
      }),
    );
    const messages = parseSse(await response.text());
    expect(
      messages.filter((message) => message.comment === "ping").length,
    ).toBeGreaterThanOrEqual(2);
    expect(messages.at(-1)?.event).toBe("reconnect");
    expect(messages.some((message) => message.event === "terminal")).toBe(
      false,
    );
  });

  it("stops when the request signal aborts", async () => {
    const { store, clock } = await setup();
    const controller = new AbortController();
    let polls = 0;
    const response = await relayRun(
      options(store, clock, {
        signal: controller.signal,
        sleep: (ms) => {
          clock.advance(ms);
          polls += 1;
          if (polls === 3) controller.abort();
          return Promise.resolve();
        },
      }),
    );
    const messages = parseSse(await response.text());
    expect(messages.some((message) => message.event === "terminal")).toBe(
      false,
    );
    expect(polls).toBe(3);
  });

  it("answers 404 for an unknown run", async () => {
    const { store, clock } = await setup();
    expect(
      (await relayRun(options(store, clock, { runId: "missing" }))).status,
    ).toBe(404);
  });
});
