import { realSleep, systemClock, type Clock, type Sleep } from "./clock.ts";
import { TerminalEvent } from "./events.ts";
import { isTerminal } from "./lifecycle.ts";
import type { RunRow, RunStore } from "./run-store/types.ts";

/** How often the relay tails the store. Arbitrary. */
export const RELAY_POLL_MS = 200;
/** Comment heartbeat interval. Arbitrary. */
export const RELAY_HEARTBEAT_MS = 12_000;
/** Time before the relay asks the client to reconnect; below the function's 300 s limit. */
export const RELAY_BUDGET_MS = 270_000;

const HTTP_NO_CONTENT = 204;
const HTTP_NOT_FOUND = 404;
const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
};

export interface RelayOptions {
  readonly store: RunStore;
  readonly runId: string;
  readonly lastEventId: number | null;
  readonly signal?: AbortSignal | undefined;
  readonly clock?: Clock | undefined;
  readonly sleep?: Sleep | undefined;
  readonly pollMs?: number | undefined;
  readonly heartbeatMs?: number | undefined;
  readonly budgetMs?: number | undefined;
}

/**
 * Reads the resume point from `Last-Event-ID`, or from `?after=`.
 * @param request incoming request
 */
export function lastEventIdOf(request: Request): number | null {
  const raw =
    request.headers.get("last-event-id") ??
    new URL(request.url).searchParams.get("after");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Builds the terminal event from the run row only, never from the stream (§6.1).
 * @param row a complete or abandoned row
 */
export function terminalFromRow(row: RunRow): TerminalEvent {
  const status = row.status === "complete" ? "complete" : "abandoned";
  const event: TerminalEvent = { status };
  if (row.artifact) {
    const { version, sha256, html } = row.artifact;
    event.artifact = { version, sha256, html };
  }
  if (row.e1Score !== null) event.e1Score = row.e1Score;
  if (row.attribution) event.attribution = row.attribution;
  return TerminalEvent.parse(event);
}

function message(event: string, data: unknown, id?: number): string {
  const idLine = id === undefined ? "" : `id: ${id}\n`;
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function lastSeq(store: RunStore, runId: string): Promise<number> {
  return (await store.listEvents(runId, 0)).at(-1)?.seq ?? 0;
}

interface Tail {
  readonly options: RelayOptions;
  readonly clock: Clock;
  readonly write: (text: string) => void;
  after: number;
  lastWrite: number;
}

/** Sends new events; returns true once the terminal event has been sent. */
async function drain(tail: Tail): Promise<boolean> {
  const { store, runId } = tail.options;
  const row = await store.get(runId);
  for (const stored of await store.listEvents(runId, tail.after)) {
    tail.write(message("progress", stored.event, stored.seq));
    tail.after = stored.seq;
    tail.lastWrite = tail.clock.now();
  }
  if (!row || !isTerminal(row.status)) return false;
  tail.write(message("terminal", terminalFromRow(row), tail.after + 1));
  return true;
}

async function loop(tail: Tail): Promise<void> {
  const { options, clock } = tail;
  const started = clock.now();
  const sleep = options.sleep ?? realSleep;
  while (options.signal?.aborted !== true) {
    if (await drain(tail)) return;
    const now = clock.now();
    if (now - started >= (options.budgetMs ?? RELAY_BUDGET_MS)) {
      tail.write(message("reconnect", {}));
      return;
    }
    if (now - tail.lastWrite >= (options.heartbeatMs ?? RELAY_HEARTBEAT_MS)) {
      tail.write(": ping\n\n");
      tail.lastWrite = now;
    }
    await sleep(options.pollMs ?? RELAY_POLL_MS);
  }
}

function stream(
  options: RelayOptions,
  clock: Clock,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const tail: Tail = {
        options,
        clock,
        write: (text) => {
          controller.enqueue(encoder.encode(text));
        },
        after: options.lastEventId ?? 0,
        lastWrite: clock.now(),
      };
      try {
        await loop(tail);
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * The SSE relay (§6.2): replays stored events after the resume point, tails the store, and sends
 * `terminal` once the row is terminal and every event has gone out. A resume point at or past the
 * terminal id gets 204, which stops `EventSource` from reconnecting.
 * @param options store, run id, resume point, signal and timing overrides
 */
export async function relayRun(options: RelayOptions): Promise<Response> {
  const clock = options.clock ?? systemClock;
  const row = await options.store.get(options.runId);
  if (!row)
    return Response.json({ error: "unknown run" }, { status: HTTP_NOT_FOUND });
  if (isTerminal(row.status) && options.lastEventId !== null) {
    const terminalId = (await lastSeq(options.store, options.runId)) + 1;
    if (options.lastEventId >= terminalId)
      return new Response(null, { status: HTTP_NO_CONTENT });
  }
  return new Response(stream(options, clock), { headers: SSE_HEADERS });
}
