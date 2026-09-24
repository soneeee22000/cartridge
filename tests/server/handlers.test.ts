import { describe, expect, it } from "vitest";
import { manualClock } from "../../src/engine/clock.ts";
import { MemoryRunStore } from "../../src/engine/run-store/memory.ts";
import { adhocRunKey, createDevHandler } from "../../src/server/handlers.ts";
import { createDriverQueue } from "../../src/server/queue.ts";

function setup() {
  const store = new MemoryRunStore(manualClock(0));
  const queued: string[] = [];
  let next = 0;
  const handler = createDevHandler({
    store,
    enqueue: (runId) => {
      queued.push(runId);
    },
    newId: () => `run-${(next += 1)}`,
  });
  return { store, queued, handler };
}

function post(body: unknown): Request {
  return new Request("http://localhost/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("dev handlers (§6.3)", () => {
  it("accepts POST /runs with 202, writes a waiting row and enqueues it", async () => {
    const { store, queued, handler } = setup();
    const response = await handler(post({ prompt: "A snail race on a leaf" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ runId: "run-1" });
    expect(queued).toEqual(["run-1"]);
    expect(await store.get("run-1")).toMatchObject({
      status: "waiting",
      runKey: adhocRunKey("A snail race on a leaf"),
    });
  });

  it("uses promptId as the run key when given", async () => {
    const { store, handler } = setup();
    await handler(post({ prompt: "x", promptId: "snail-race" }));
    expect((await store.get("run-1"))?.runKey).toBe("snail-race");
  });

  it("derives a stable ad-hoc run key, never a random one", () => {
    expect(adhocRunKey("same")).toBe(adhocRunKey("same"));
    expect(adhocRunKey("same")).toMatch(/^adhoc-[0-9a-f]{12}$/);
  });

  it("rejects a malformed body with 400", async () => {
    const { handler, queued } = setup();
    expect((await handler(post({ nope: true }))).status).toBe(400);
    const bad = new Request("http://localhost/runs", {
      method: "POST",
      body: "{",
    });
    expect((await handler(bad)).status).toBe(400);
    expect(queued).toEqual([]);
  });

  it("relays GET /runs/:id/events and 404s unknown routes", async () => {
    const { handler } = setup();
    expect(
      (await handler(new Request("http://localhost/runs/none/events"))).status,
    ).toBe(404);
    expect(
      (await handler(new Request("http://localhost/elsewhere"))).status,
    ).toBe(404);
  });
});

describe("driver queue", () => {
  it("runs at most the configured number of drivers at once", async () => {
    let active = 0;
    let peak = 0;
    const done: string[] = [];
    const queue = createDriverQueue(2, async (runId) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      done.push(runId);
    });
    for (const id of ["a", "b", "c", "d"]) queue.enqueue(id);
    await queue.idle();
    expect(peak).toBe(2);
    expect(done.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps going after a driver throws", async () => {
    const done: string[] = [];
    const queue = createDriverQueue(1, (runId) => {
      if (runId === "bad") return Promise.reject(new Error("boom"));
      done.push(runId);
      return Promise.resolve();
    });
    queue.enqueue("bad");
    queue.enqueue("good");
    await queue.idle();
    expect(done).toEqual(["good"]);
  });
});
