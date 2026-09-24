import type { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import type { CartridgeData } from "../events.ts";
import type { CartridgeContext } from "../schemas.ts";
import { toUsage, type Usage } from "../usage.ts";

/** Writes one `data-cartridge` progress event into the workflow stream. */
export type Emit = (data: CartridgeData) => Promise<void>;

/** Any agent, whatever its tools and output type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgent = Agent<any, any, any>;

export type CartridgeRequestContext = RequestContext<CartridgeContext>;

/** The parts of an agent stream the phases read, after the stream has been consumed. */
export interface CallOutcome {
  readonly usage: Usage;
  readonly finishReason: string | null;
  readonly error: unknown;
}

interface StreamLike {
  readonly fullStream: ReadableStream<unknown>;
  readonly totalUsage: Promise<Parameters<typeof toUsage>[0]>;
  readonly finishReason: Promise<string | undefined>;
  readonly error: Error | undefined;
}

const ToolCallChunk = (chunk: unknown): string | null => {
  if (typeof chunk !== "object" || chunk === null) return null;
  const { type, payload } = chunk as {
    type?: unknown;
    payload?: { toolName?: unknown };
  };
  if (type !== "tool-call" || typeof payload?.toolName !== "string")
    return null;
  return payload.toolName;
};

/**
 * Consumes an agent stream, emitting `tool.call` for each tool call, then reads usage and the
 * finish reason. Model errors surface on `error`, not as a rejection.
 * @param output the agent's stream output
 * @param phase which phase the calls belong to
 * @param emit progress writer
 */
export async function consumeCall(
  output: StreamLike,
  phase: "plan" | "generate",
  emit: Emit,
): Promise<CallOutcome> {
  for await (const chunk of output.fullStream) {
    const tool = ToolCallChunk(chunk);
    if (tool) await emit({ kind: "tool.call", data: { phase, tool } });
  }
  const usage = toUsage(await output.totalUsage);
  const finishReason = (await output.finishReason) ?? null;
  return { usage, finishReason, error: output.error };
}
