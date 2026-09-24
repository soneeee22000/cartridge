import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

/** A Web-standard request handler, shared by the dev server and the deploy bundle. */
export type WebHandler = (request: Request) => Response | Promise<Response>;

const FALLBACK_HOST = "localhost";
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

function toRequest(incoming: IncomingMessage, signal: AbortSignal): Request {
  const host = incoming.headers.host ?? FALLBACK_HOST;
  const url = new URL(incoming.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value !== undefined)
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = incoming.method ?? "GET";
  if (BODYLESS_METHODS.has(method))
    return new Request(url, { method, headers, signal });
  const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
  return new Request(url, {
    method,
    headers,
    body,
    duplex: "half",
    signal,
  });
}

/**
 * Wraps a Web handler as a Node `(req, res)` handler, streaming the response body as it is produced.
 * A client that disconnects before the response finishes aborts `request.signal`, so relays and
 * drivers stop with it.
 * @param handler Web-standard handler
 */
export function toNodeHandler(
  handler: WebHandler,
): (incoming: IncomingMessage, outgoing: ServerResponse) => Promise<void> {
  return async (incoming, outgoing) => {
    const disconnect = new AbortController();
    outgoing.on("close", () => {
      if (!outgoing.writableFinished) disconnect.abort();
    });
    const response = await handler(toRequest(incoming, disconnect.signal));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) {
      outgoing.end();
      return;
    }
    const body = Readable.fromWeb(response.body);
    body.pipe(outgoing);
    await new Promise<void>((resolve, reject) => {
      outgoing.on("close", () => {
        body.destroy();
        resolve();
      });
      body.on("error", reject);
    });
  };
}
