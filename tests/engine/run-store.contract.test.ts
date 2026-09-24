import { afterEach, describe, expect, it } from "vitest";
import { manualClock, type ManualClock } from "../../src/engine/clock.ts";
import { driverAttribution } from "../../src/engine/attribution.ts";
import {
  MAX_CLAIMS,
  SEAL_LEASE_MS,
  STALE_ACTIVE_MS,
} from "../../src/engine/lifecycle.ts";
import { LibSqlRunStore } from "../../src/engine/run-store/libsql.ts";
import { MemoryRunStore } from "../../src/engine/run-store/memory.ts";
import type {
  CompleteResult,
  RunStore,
} from "../../src/engine/run-store/types.ts";
import { MOCK_SPEC } from "../../src/models/mock.ts";

const START = 1_000_000;
const RESULT: CompleteResult = {
  spec: MOCK_SPEC,
  artifact: { version: "a0", sha256: "a".repeat(64), bytes: 4, html: "<p/>" },
  e1Score: 1,
};
const OTHER_RESULT: CompleteResult = {
  ...RESULT,
  artifact: { ...RESULT.artifact, sha256: "b".repeat(64) },
};

interface Harness {
  readonly store: RunStore;
  readonly clock: ManualClock;
  readonly close: () => void;
}

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const implementations: [string, () => Promise<Harness>][] = [
  [
    "memory",
    () => {
      const clock = manualClock(START);
      return Promise.resolve({
        store: new MemoryRunStore(clock),
        clock,
        close: () => undefined,
      });
    },
  ],
  [
    "libsql",
    async () => {
      const clock = manualClock(START);
      const store = await LibSqlRunStore.open(":memory:", clock);
      return {
        store,
        clock,
        close: () => {
          store.close();
        },
      };
    },
  ],
];

async function harness(make: () => Promise<Harness>): Promise<Harness> {
  const made = await make();
  closers.push(made.close);
  await made.store.create({
    id: "run-1",
    runKey: "kite-rush",
    prompt: "kites",
    maxClaims: MAX_CLAIMS,
  });
  return made;
}

describe.each(implementations)(
  "%s run store contract (§5.3)",
  (_name, make) => {
    it("creates a waiting row and returns null for an unknown id", async () => {
      const { store } = await harness(make);
      expect(await store.get("run-1")).toMatchObject({
        id: "run-1",
        runKey: "kite-rush",
        status: "waiting",
        claims: 0,
        maxClaims: MAX_CLAIMS,
        owner: null,
        createdAt: START,
      });
      expect(await store.get("nope")).toBeNull();
    });

    it("lets exactly one of two concurrent claims win", async () => {
      const { store, clock } = await harness(make);
      const results = await Promise.all([
        store.claim("run-1", "driver-a", clock.now()),
        store.claim("run-1", "driver-b", clock.now()),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await store.get("run-1")).toMatchObject({
        status: "active",
        claims: 1,
      });
    });

    it("heartbeats only for the owner of an active row", async () => {
      const { store, clock } = await harness(make);
      await store.claim("run-1", "driver-a", clock.now());
      clock.advance(10);
      expect(await store.heartbeat("run-1", "driver-a", clock.now())).toBe(
        true,
      );
      expect(await store.heartbeat("run-1", "driver-b", clock.now())).toBe(
        false,
      );
      expect((await store.get("run-1"))?.heartbeatAt).toBe(START + 10);
    });

    it("reclaims a stale active row and cuts the old owner off", async () => {
      const { store, clock } = await harness(make);
      await store.claim("run-1", "driver-a", clock.now());
      clock.advance(STALE_ACTIVE_MS - 1);
      expect(await store.claim("run-1", "driver-b", clock.now())).toBe(false);
      clock.advance(2);
      expect(await store.claim("run-1", "driver-b", clock.now())).toBe(true);
      expect(await store.heartbeat("run-1", "driver-a", clock.now())).toBe(
        false,
      );
      expect(await store.get("run-1")).toMatchObject({
        owner: "driver-b",
        claims: 2,
      });
    });

    it("refuses a claim once claims reach maxClaims", async () => {
      const { store, clock } = await harness(make);
      for (let claim = 0; claim < MAX_CLAIMS; claim += 1) {
        expect(await store.claim("run-1", `driver-${claim}`, clock.now())).toBe(
          true,
        );
        await store.release(
          "run-1",
          `driver-${claim}`,
          driverAttribution("stream-cut", "cut"),
        );
      }
      expect(await store.claim("run-1", "driver-late", clock.now())).toBe(
        false,
      );
    });

    it("seals under a lease, completes once and re-seals idempotently", async () => {
      const { store, clock } = await harness(make);
      await store.claim("run-1", "driver-a", clock.now());
      expect(await store.beginSeal("run-1", "driver-b", clock.now())).toBe(
        false,
      );
      expect(await store.beginSeal("run-1", "driver-a", clock.now())).toBe(
        true,
      );
      expect(await store.get("run-1")).toMatchObject({
        status: "sealing",
        sealOwner: "driver-a",
        sealUntil: START + SEAL_LEASE_MS,
      });
      expect(await store.completeSeal("run-1", "driver-b", RESULT)).toBe(false);
      expect(await store.completeSeal("run-1", "driver-a", RESULT)).toBe(true);
      expect(await store.get("run-1")).toMatchObject({
        status: "complete",
        e1Score: 1,
        spec: MOCK_SPEC,
        artifact: RESULT.artifact,
      });
      expect(await store.completeSeal("run-1", "driver-a", RESULT)).toBe(true);
      expect(await store.completeSeal("run-1", "driver-a", OTHER_RESULT)).toBe(
        false,
      );
    });

    it("reclaims a row whose seal lease expired", async () => {
      const { store, clock } = await harness(make);
      await store.claim("run-1", "driver-a", clock.now());
      await store.beginSeal("run-1", "driver-a", clock.now());
      expect(await store.claim("run-1", "driver-b", clock.now())).toBe(false);
      clock.advance(SEAL_LEASE_MS + 1);
      expect(await store.claim("run-1", "driver-b", clock.now())).toBe(true);
      expect(await store.completeSeal("run-1", "driver-a", RESULT)).toBe(false);
      expect(await store.beginSeal("run-1", "driver-b", clock.now())).toBe(
        true,
      );
      expect(await store.completeSeal("run-1", "driver-b", RESULT)).toBe(true);
    });

    it("abandons and releases only for the owner, recording the attribution", async () => {
      const { store, clock } = await harness(make);
      const cut = driverAttribution("stream-cut", "stream closed early");
      await store.claim("run-1", "driver-a", clock.now());
      expect(await store.release("run-1", "driver-b", cut)).toBe(false);
      expect(await store.release("run-1", "driver-a", cut)).toBe(true);
      expect(await store.get("run-1")).toMatchObject({
        status: "waiting",
        owner: null,
        attribution: cut,
      });
      await store.claim("run-1", "driver-c", clock.now());
      const crash = driverAttribution("engine-crashed", "bug");
      expect(await store.abandon("run-1", "driver-a", crash)).toBe(false);
      expect(await store.abandon("run-1", "driver-c", crash)).toBe(true);
      expect(await store.get("run-1")).toMatchObject({
        status: "abandoned",
        attribution: crash,
      });
      expect(await store.claim("run-1", "driver-d", clock.now())).toBe(false);
    });

    it("appends events with a per-run sequence and lists them after a seq", async () => {
      const { store, clock } = await harness(make);
      await store.create({
        id: "run-2",
        runKey: "other",
        prompt: "x",
        maxClaims: 1,
      });
      await store.claim("run-1", "driver-a", clock.now());
      await store.claim("run-2", "driver-a", clock.now());
      expect(
        await store.appendEvent("run-1", "driver-a", {
          kind: "run.claimed",
          data: { claimAttempt: 1 },
        }),
      ).toBe(1);
      clock.advance(5);
      expect(
        await store.appendEvent("run-1", "driver-a", {
          kind: "step.start",
          data: { step: "plan" },
        }),
      ).toBe(2);
      expect(
        await store.appendEvent("run-2", "driver-a", {
          kind: "step.start",
          data: { step: "plan" },
        }),
      ).toBe(1);
      const all = await store.listEvents("run-1", 0);
      expect(all.map((stored) => stored.seq)).toEqual([1, 2]);
      expect(all[1]).toEqual({
        seq: 2,
        at: START + 5,
        event: { kind: "step.start", data: { step: "plan" } },
      });
      expect(
        (await store.listEvents("run-1", 1)).map((stored) => stored.seq),
      ).toEqual([2]);
    });

    it("fences the event log to the current lease holder", async () => {
      const { store, clock } = await harness(make);
      const event = { kind: "step.start", data: { step: "plan" } } as const;
      expect(await store.appendEvent("run-1", "driver-a", event)).toBeNull();
      await store.claim("run-1", "driver-a", clock.now());
      expect(await store.appendEvent("run-1", "driver-b", event)).toBeNull();
      expect(await store.appendEvent("run-1", "driver-a", event)).toBe(1);
      clock.advance(STALE_ACTIVE_MS + 1);
      await store.claim("run-1", "driver-b", clock.now());
      expect(await store.appendEvent("run-1", "driver-a", event)).toBeNull();
      await store.beginSeal("run-1", "driver-b", clock.now());
      expect(await store.appendEvent("run-1", "driver-b", event)).toBe(2);
      await store.completeSeal("run-1", "driver-b", RESULT);
      expect(await store.appendEvent("run-1", "driver-b", event)).toBeNull();
      expect(
        (await store.listEvents("run-1", 0)).map((stored) => stored.seq),
      ).toEqual([1, 2]);
    });

    it("lets the seal owner back out of sealing with abandon or release", async () => {
      const { store, clock } = await harness(make);
      const crash = driverAttribution("engine-crashed", "commit failed");
      await store.claim("run-1", "driver-a", clock.now());
      await store.beginSeal("run-1", "driver-a", clock.now());
      expect(await store.abandon("run-1", "driver-b", crash)).toBe(false);
      expect(await store.release("run-1", "driver-a", crash)).toBe(true);
      expect(await store.get("run-1")).toMatchObject({
        status: "waiting",
        attribution: crash,
      });
      await store.claim("run-1", "driver-c", clock.now());
      await store.beginSeal("run-1", "driver-c", clock.now());
      expect(await store.abandon("run-1", "driver-c", crash)).toBe(true);
      expect((await store.get("run-1"))?.status).toBe("abandoned");
    });
  },
);
