import { afterEach, describe, expect, it } from "vitest";
import { systemClock } from "../../src/engine/clock.ts";
import { MemoryRunStore } from "../../src/engine/run-store/memory.ts";
import { MOCK_GAME_HTML } from "../../src/models/mock.ts";
import { startDevServer, type DevServer } from "../../src/server/dev.ts";

let server: DevServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe("dev server in mock mode (§14 S2)", () => {
  it("accepts POST /runs and streams the run to a complete terminal event", async () => {
    server = await startDevServer({
      port: 0,
      mode: "mock",
      store: new MemoryRunStore(systemClock),
      env: {},
    });
    const created = await fetch(`${server.url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "A lantern floating up a night street" }),
    });
    expect(created.status).toBe(202);
    const { runId } = (await created.json()) as { runId: string };

    const events = await fetch(`${server.url}/runs/${runId}/events`);
    expect(events.headers.get("content-type")).toBe("text/event-stream");
    const text = await events.text();
    expect(text).toContain("event: progress");
    expect(text).toContain('"kind":"verify.verdict"');
    const terminal =
      text.split("\n\n").find((block) => block.includes("event: terminal")) ??
      "";
    const data = JSON.parse(terminal.split("data: ")[1] ?? "{}") as {
      status: string;
      artifact?: { html: string };
    };
    expect(data.status).toBe("complete");
    expect(data.artifact?.html).toBe(MOCK_GAME_HTML);
  });

  it("answers 400 to a malformed run id and keeps serving", async () => {
    server = await startDevServer({
      port: 0,
      mode: "mock",
      store: new MemoryRunStore(systemClock),
      env: {},
    });
    const bad = await fetch(`${server.url}/runs/%E0/events`);
    expect(bad.status).toBe(400);
    const unknown = await fetch(`${server.url}/runs/none/events`);
    expect(unknown.status).toBe(404);
  });
});
