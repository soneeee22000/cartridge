import type { ReplayAction } from "../viewmodel/replay-state";

/** The two speeds a visitor can pick; the server rejects anything else. */
export type ReplayPace = "fast" | "recorded";

/** The replay endpoint for one catalog item at one speed. */
export function replayUrl(promptId: string, pace: ReplayPace): string {
  return `/api/replay?promptId=${encodeURIComponent(promptId)}&pace=${pace}`;
}

/** Closes one replay connection. */
export type Disconnect = () => void;

/** The sequence number of a message, from its SSE `id:` line. */
function seqOf(event: MessageEvent<string>): number {
  const seq = Number(event.lastEventId);
  return Number.isInteger(seq) ? seq : 0;
}

/** Consecutive errors with no message in between before the page stops retrying (arbitrary). */
export const MAX_SILENT_ERRORS = 3;

/** What one connection has seen so far. */
export interface ConnectionTally {
  readonly closed: boolean;
  readonly received: number;
  readonly silentErrors: number;
}

/** How to treat a connection error: keep retrying, or stop and say why. */
export type ErrorOutcome = "retry" | "refused" | "unreachable" | "lost";

/**
 * Decide what a connection error means. The browser retries on its own, so the page only stops
 * it after `MAX_SILENT_ERRORS` errors in a row with no message between them.
 * @param tally whether the source is closed, messages received, and errors since the last message
 */
export function errorOutcome(tally: ConnectionTally): ErrorOutcome {
  if (tally.closed) return "refused";
  if (tally.silentErrors < MAX_SILENT_ERRORS) return "retry";
  return tally.received === 0 ? "unreachable" : "lost";
}

const FAILURE_TEXT: Readonly<Record<Exclude<ErrorOutcome, "retry">, string>> =
  {
    refused:
      "The server refused or closed the replay stream. Try again, or pick another prompt.",
    unreachable:
      "Could not reach the replay server. Check your connection and try again.",
    lost: "The connection kept dropping, so the replay was stopped. Try again.",
  };

/** Report a connection error as a reconnect while retrying is worth it, or a failure. */
function onError(
  source: EventSource,
  tally: ConnectionTally,
  dispatch: (action: ReplayAction) => void,
): void {
  const outcome = errorOutcome(tally);
  if (outcome === "retry") {
    dispatch({ type: "connection-lost" });
    return;
  }
  source.close();
  dispatch({ type: "failed", message: FAILURE_TEXT[outcome] });
}

/**
 * Open an `EventSource` on `/api/replay` and turn its messages into reducer actions. The browser
 * reconnects on its own with `Last-Event-ID`; after the terminal event the connection is closed
 * here, and the server would answer a late reconnect with 204.
 * @param promptId catalog item id
 * @param pace fast-forward or recorded pace
 * @param dispatch receives every action, in arrival order
 * @returns a function that closes the connection; the server then stops the run
 */
export function openReplay(
  promptId: string,
  pace: ReplayPace,
  dispatch: (action: ReplayAction) => void,
): Disconnect {
  const source = new EventSource(replayUrl(promptId, pace));
  let received = 0;
  let silentErrors = 0;
  const heard = (): void => {
    received += 1;
    silentErrors = 0;
  };
  source.addEventListener("progress", (event: MessageEvent<string>) => {
    heard();
    dispatch({ type: "progress", seq: seqOf(event), data: event.data });
  });
  source.addEventListener("terminal", (event: MessageEvent<string>) => {
    heard();
    source.close();
    dispatch({ type: "terminal", seq: seqOf(event), data: event.data });
  });
  source.addEventListener("reconnect", () => {
    heard();
    dispatch({ type: "reconnect" });
  });
  source.addEventListener("error", () => {
    silentErrors += 1;
    const closed = source.readyState === EventSource.CLOSED;
    onError(source, { closed, received, silentErrors }, dispatch);
  });
  return () => {
    source.close();
  };
}
