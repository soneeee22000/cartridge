import type {
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { MOCK_GAME_HTML, MOCK_SPEC } from "./mock-game.ts";

export { MOCK_GAME_HTML, MOCK_SPEC };

type FinishReason = "stop" | "length" | "content-filter" | "tool-calls";

export interface TurnUsage {
  readonly input: number;
  readonly output: number;
}

/** One scripted model turn (§7.1). */
export type Turn =
  | {
      readonly kind: "tool";
      readonly tool: string;
      readonly input: unknown;
      readonly usage?: TurnUsage;
    }
  | {
      readonly kind: "text";
      readonly text: string;
      readonly finishReason?: FinishReason;
      readonly usage?: TurnUsage;
    }
  | {
      readonly kind: "cut-tool";
      readonly tool: string;
      readonly partial: string;
    }
  | { readonly kind: "error"; readonly error: unknown };

const DEFAULT_TOOL_USAGE: TurnUsage = { input: 10, output: 5 };
const DEFAULT_TEXT_USAGE: TurnUsage = { input: 7, output: 3 };
const EXHAUSTED_TEXT = "done";

function usageOf(usage: TurnUsage): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: usage.input,
      noCache: usage.input,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: { total: usage.output, text: usage.output, reasoning: 0 },
  };
}

function finish(
  reason: FinishReason,
  usage: TurnUsage,
): LanguageModelV4StreamPart {
  return {
    type: "finish",
    finishReason: { unified: reason, raw: undefined },
    usage: usageOf(usage),
  };
}

function textParts(text: string, reason: FinishReason, usage: TurnUsage) {
  const parts: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "text-0" },
    { type: "text-delta", id: "text-0", delta: text },
    { type: "text-end", id: "text-0" },
    finish(reason, usage),
  ];
  return parts;
}

function turnParts(turn: Turn, index: number): LanguageModelV4StreamPart[] {
  if (turn.kind === "error") throw turn.error;
  if (turn.kind === "text")
    return textParts(
      turn.text,
      turn.finishReason ?? "stop",
      turn.usage ?? DEFAULT_TEXT_USAGE,
    );
  if (turn.kind === "cut-tool")
    return [
      { type: "stream-start", warnings: [] },
      { type: "tool-input-start", id: `call-${index}`, toolName: turn.tool },
      { type: "tool-input-delta", id: `call-${index}`, delta: turn.partial },
      finish("length", DEFAULT_TOOL_USAGE),
    ];
  return [
    { type: "stream-start", warnings: [] },
    {
      type: "tool-call",
      toolCallId: `call-${index}`,
      toolName: turn.tool,
      input: JSON.stringify(turn.input),
    },
    finish("tool-calls", turn.usage ?? DEFAULT_TOOL_USAGE),
  ];
}

/**
 * A mock model that plays the turns in order, one per model call; after the last turn it answers
 * with plain text. Wraps `MockLanguageModelV4` from `ai/test`.
 * @param turns scripted turns
 */
export function scriptedTurns(turns: readonly Turn[]): MockLanguageModelV4 {
  let cursor = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      const index = cursor;
      cursor += 1;
      const turn = turns[index] ?? { kind: "text", text: EXHAUSTED_TEXT };
      return Promise.resolve({
        stream: convertArrayToReadableStream(turnParts(turn, index)),
      });
    },
  });
}

function lastRole(options: LanguageModelV4CallOptions): string | undefined {
  return options.prompt.at(-1)?.role;
}

/**
 * Stateless mock models for the dev server's mock mode: the planner always returns `MOCK_SPEC`,
 * and the builder saves `MOCK_GAME_HTML` and then says so.
 */
export function demoMockModels(): {
  planner: MockLanguageModelV4;
  builder: MockLanguageModelV4;
} {
  const planner = new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: convertArrayToReadableStream(
          textParts(JSON.stringify(MOCK_SPEC), "stop", DEFAULT_TEXT_USAGE),
        ),
      }),
  });
  const builder = new MockLanguageModelV4({
    doStream: (options) => {
      const turn: Turn =
        lastRole(options) === "tool"
          ? { kind: "text", text: "Saved the game." }
          : {
              kind: "tool",
              tool: "save_draft",
              input: { html: MOCK_GAME_HTML },
            };
      return Promise.resolve({
        stream: convertArrayToReadableStream(turnParts(turn, 0)),
      });
    },
  });
  return { planner, builder };
}
