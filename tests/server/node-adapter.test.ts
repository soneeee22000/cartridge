import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toNodeHandler } from "../../src/server/node-adapter.ts";

let server: Server | null = null;
const SSE_HELLO = "data: hi\n\n";

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

  it("aborts request.signal when the client disconnects mid-stream", async () => {
    let signal: AbortSignal | null = null;
    const base = await serve((request) => {
      signal = request.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(SSE_HELLO));
        },
      });
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const client = new AbortController();
    const response = await fetch(base, { signal: client.signal });
    const reader = response.body?.getReader();
    await reader?.read();
    client.abort();
    await vi.waitFor(() => {
      expect(signal?.aborted).toBe(true);
    });
  });
});
