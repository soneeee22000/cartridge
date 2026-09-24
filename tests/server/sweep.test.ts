import { describe, expect, it } from "vitest";
import { driverAttribution } from "../../src/engine/attribution.ts";
import { manualClock } from "../../src/engine/clock.ts";
import { STALE_ACTIVE_MS } from "../../src/engine/lifecycle.ts";
import { MemoryRunStore } from "../../src/engine/run-store/memory.ts";
import { sweepRuns } from "../../src/server/sweep.ts";

async function seeded() {
  const clock = manualClock(0);
  const store = new MemoryRunStore(clock);
  for (const [id, maxClaims] of [
    ["waiting", 2],
    ["stale-with-claims", 2],
    ["stale-last-claim", 1],
    ["live", 2],
    ["done", 1],
  ] as const)
    await store.create({ id, runKey: id, prompt: "p", maxClaims });
  await store.claim("stale-with-claims", "gone", clock.now());
  await store.claim("stale-last-claim", "gone", clock.now());
  await store.claim("done", "gone", clock.now());
  await store.abandon(
    "done",
    "gone",
    driverAttribution("engine-crashed", "bug"),
  );
  clock.advance(STALE_ACTIVE_MS + 1);
  await store.claim("live", "here", clock.now());
  return { clock, store };
}

describe("sweepRuns (§5.4)", () => {
  it("enqueues claimable rows and abandons stale rows with no claims left", async () => {
    const { clock, store } = await seeded();
    const enqueued: string[] = [];
    await sweepRuns({
      store,
      clock,
      enqueue: (runId) => {
        enqueued.push(runId);
      },
    });
    expect(enqueued).toEqual(["waiting", "stale-with-claims"]);
    expect(await store.get("stale-last-claim")).toMatchObject({
      status: "abandoned",
      attribution: { step: "driver", code: "lease-lost" },
    });
    expect((await store.get("live"))?.status).toBe("active");
  });
});
