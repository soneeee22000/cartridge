/** One Server-Sent Events message: its id, event name and data line. */
export interface SseMessage {
  readonly id: number | null;
  readonly event: string;
  readonly data: string;
}

const DEFAULT_EVENT = "message";
const FIELD_SEPARATOR = ": ";

/** Parse one message block; a comment-only block (a heartbeat) yields null. */
function parseBlock(block: string): SseMessage | null {
  const fields = new Map<string, string>();
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(FIELD_SEPARATOR);
    if (colon > 0)
      fields.set(
        line.slice(0, colon),
        line.slice(colon + FIELD_SEPARATOR.length),
      );
  }
  const data = fields.get("data");
  if (data === undefined) return null;
  const rawId = fields.get("id");
  return {
    id: rawId === undefined ? null : Number(rawId),
    event: fields.get("event") ?? DEFAULT_EVENT,
    data,
  };
}

/**
 * Split a recorded SSE body into messages, dropping heartbeat comments. The page itself reads the
 * stream through `EventSource`; this parser feeds recorded transcripts to the reducer tests and the
 * capture script.
 */
export function parseSseTranscript(text: string): SseMessage[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n\n")
    .map(parseBlock)
    .filter((message): message is SseMessage => message !== null);
}
