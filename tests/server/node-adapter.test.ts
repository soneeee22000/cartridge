import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { toNodeHandler } from "../../src/server/node-adapter.ts";

let server: Server | null = null;

async function serve(
  handler: Parameters<typeof toNodeHandler>[0],
): Promise<string> {
  const node = toNodeHandler(handler);
  server = createServer((incoming, outgoing) => {
    void node(incoming, outgoing);
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  const running = server;
  server = null;
  if (!running) return;
  await new Promise<void>((resolve) => {
    running.close(() => {
      resolve();
    });
  });
});

describe("toNodeHandler", () => {
  it("passes method, path and headers through and streams the body", async () => {
    const base = await serve((request) =>
      Response.json({
        method: request.method,
        path: new URL(request.url).pathname,
        probe: request.headers.get("x-probe"),
      }),
    );
    const response = await fetch(`${base}/api/replay?promptId=a`, {
      headers: { "x-probe": "yes" },
    });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      method: "GET",
      path: "/api/replay",
      probe: "yes",
    });
  });

  it("forwards a request body and an empty response", async () => {
    let received = "";
    const base = await serve(async (request) => {
      received = await request.text();
      return new Response(null, { status: 204 });
    });
    const response = await fetch(base, { method: "POST", body: "hello" });
    expect(response.status).toBe(204);
    expect(received).toBe("hello");
  });
});
