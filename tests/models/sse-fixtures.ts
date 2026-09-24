export interface SseUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

const event = (type: string, data: object): string =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

function start(id: string, usage: SseUsage): string {
  return event("message_start", {
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: usage.input,
        cache_read_input_tokens: usage.cacheRead ?? 0,
        cache_creation_input_tokens: usage.cacheWrite ?? 0,
        output_tokens: 1,
      },
    },
  });
}

function stop(reason: string, usage: SseUsage): string {
  return (
    event("message_delta", {
      delta: { stop_reason: reason, stop_sequence: null },
      usage: { output_tokens: usage.output },
    }) + event("message_stop", {})
  );
}

/** An Anthropic streaming body that ends with plain text. */
export function textSse(
  text: string,
  usage: SseUsage = { input: 3, output: 2 },
): string {
  return [
    start("msg_text", usage),
    event("content_block_start", {
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    event("content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text },
    }),
    event("content_block_stop", { index: 0 }),
    stop("end_turn", usage),
  ].join("");
}

/** An Anthropic streaming body that calls one tool. */
export function toolSse(
  name: string,
  input: object,
  usage: SseUsage = { input: 10, output: 5 },
): string {
  return [
    start("msg_tool", usage),
    event("content_block_start", {
      index: 0,
      content_block: { type: "tool_use", id: "toolu_fixed", name, input: {} },
    }),
    event("content_block_delta", {
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    }),
    event("content_block_stop", { index: 0 }),
    stop("tool_use", usage),
  ].join("");
}

/** A fake upstream fetch that answers with the given bodies in order and logs each request body. */
export function fakeUpstream(
  bodies: readonly string[],
  status = 200,
): { fetch: typeof fetch; requests: unknown[] } {
  const requests: unknown[] = [];
  let index = 0;
  const upstream = ((_input: string | URL | Request, init?: RequestInit) => {
    requests.push(
      JSON.parse(typeof init?.body === "string" ? init.body : "null"),
    );
    const body = bodies[Math.min(index, bodies.length - 1)] ?? "";
    index += 1;
    const contentType = status < 300 ? "text/event-stream" : "application/json";
    return Promise.resolve(
      new Response(body, { status, headers: { "content-type": contentType } }),
    );
  }) as typeof fetch;
  return { fetch: upstream, requests };
}
