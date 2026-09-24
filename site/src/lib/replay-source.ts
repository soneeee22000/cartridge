import type { ReplayAction } from "../viewmodel/replay-state";

/** The replay endpoint for one catalog item. */
export function replayUrl(promptId: string): string {
  return `/api/replay?promptId=${encodeURIComponent(promptId)}`;
}

/** Closes one replay connection. */
export type Disconnect = () => void;

/** The sequence number of a message, from its SSE `id:` line. */
function seqOf(event: MessageEvent<string>): number {
  const seq = Number(event.lastEventId);
  return Number.isInteger(seq) ? seq : 0;
}

/** Report a connection error as a reconnect while the browser retries, or a failure once it gives up. */
function onError(
  source: EventSource,
  dispatch: (action: ReplayAction) => void,
): void {
  if (source.readyState === EventSource.CLOSED) {
    dispatch({
      type: "failed",
      message:
        "The server refused or closed the replay stream. Try again, or pick another prompt.",
    });
    return;
  }
  dispatch({ type: "connection-lost" });
}

/**
 * Open an `EventSource` on `/api/replay` and turn its messages into reducer actions. The browser
 * reconnects on its own with `Last-Event-ID`; after the terminal event the connection is closed
 * here, and the server would answer a late reconnect with 204.
 * @param promptId catalog item id
 * @param dispatch receives every action, in arrival order
 * @returns a function that closes the connection; the server then stops the run
 */
export function openReplay(
  promptId: string,
  dispatch: (action: ReplayAction) => void,
): Disconnect {
  const source = new EventSource(replayUrl(promptId));
  source.addEventListener("progress", (event: MessageEvent<string>) => {
    dispatch({ type: "progress", seq: seqOf(event), data: event.data });
  });
  source.addEventListener("terminal", (event: MessageEvent<string>) => {
    source.close();
    dispatch({ type: "terminal", seq: seqOf(event), data: event.data });
  });
  source.addEventListener("reconnect", () => {
    dispatch({ type: "reconnect" });
  });
  source.addEventListener("error", () => {
    onError(source, dispatch);
  });
  return () => {
    source.close();
  };
}
