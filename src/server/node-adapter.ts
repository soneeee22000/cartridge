import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

/** A Web-standard request handler, shared by the dev server and the deploy bundle. */
export type WebHandler = (request: Request) => Response | Promise<Response>;

const FALLBACK_HOST = "localhost";
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
const HTTP_INTERNAL_ERROR = 500;

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

async function respond(
  handler: WebHandler,
  request: Request,
): Promise<Response> {
  try {
    return await handler(request);
  } catch {
    return Response.json(
      { error: "internal error" },
      { status: HTTP_INTERNAL_ERROR },
    );
  }
}

function pipeBody(
  body: ReadableStream<Uint8Array>,
  outgoing: ServerResponse,
): Promise<void> {
  const source = Readable.fromWeb(body);
  source.pipe(outgoing);
  return new Promise<void>((resolve) => {
    outgoing.on("close", () => {
      source.destroy();
      resolve();
    });
    source.on("error", () => {
      outgoing.destroy();
      resolve();
    });
  });
}

/**
 * Wraps a Web handler as a Node `(req, res)` handler, streaming the response body as it is produced.
 * A client that disconnects before the response finishes aborts `request.signal`, so relays and
 * drivers stop with it. The returned promise never rejects: a handler that throws answers 500, and
 * a body stream that errors mid-response closes the connection.
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
    const response = await respond(
      handler,
      toRequest(incoming, disconnect.signal),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) {
      outgoing.end();
      return;
    }
    await pipeBody(response.body, outgoing);
  };
}
