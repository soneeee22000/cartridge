import type { LanguageModelV4 } from "@ai-sdk/provider";
import { Agent } from "@mastra/core/agent";
import type { GameSpec } from "../../contract/spec.ts";
import { failureFromError } from "../../engine/attribution.ts";
import { JUDGE_MAX_OUTPUT_TOKENS } from "../../engine/budgets.ts";
import { toUsage, ZERO_USAGE, type Usage } from "../../engine/usage.ts";
import { JUDGE_INSTRUCTIONS, judgeMessage } from "./rubric.ts";
import {
  JudgeOutput,
  summariseJudgement,
  unjudged,
  type E3Result,
} from "./validate.ts";

/** The judge runs at temperature 0 (§7.1). */
const JUDGE_TEMPERATURE = 0;
/** One structured answer; the judge has no tools. */
const JUDGE_MAX_STEPS = 1;
/** Retries belong to the caller, as for every other agent (§4.6). */
const JUDGE_MAX_RETRIES = 0;

export interface JudgeInput {
  readonly prompt: string;
  readonly spec: GameSpec;
  readonly html: string;
}

export interface Judged {
  readonly result: E3Result;
  readonly usage: Usage;
}

function judgeAgent(model: LanguageModelV4): Agent {
  return new Agent({
    id: "judge",
    name: "judge",
    instructions: JUDGE_INSTRUCTIONS,
    model,
    maxRetries: JUDGE_MAX_RETRIES,
  });
}

/**
 * A judge failure as a portable message: a cassette miss carries no path or key, so a rescore on
 * another machine produces the same bytes.
 */
function judgeError(error: unknown): string {
  if (failureFromError("plan", error).code === "cassette-miss")
    return "judge cassette missing";
  const text = error instanceof Error ? error.message : String(error);
  return `judge call failed: ${text}`;
}

async function callJudge(
  model: LanguageModelV4,
  input: JudgeInput,
): Promise<Judged> {
  const output = await judgeAgent(model).stream(
    judgeMessage(input.prompt, input.spec, input.html),
    {
      structuredOutput: { schema: JudgeOutput },
      maxSteps: JUDGE_MAX_STEPS,
      modelSettings: {
        temperature: JUDGE_TEMPERATURE,
        maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
      },
    },
  );
  await output.consumeStream();
  const usage = toUsage(await output.totalUsage);
  const object: unknown = await output.object.catch(() => null);
  const failed =
    output.error ?? (object === null ? "no structured output" : null);
  const { gameType } = input.spec;
  if (failed !== null)
    return { result: unjudged(gameType, judgeError(failed)), usage };
  return { result: summariseJudgement(object, input.html, gameType), usage };
}

/**
 * E3 (§10.1): asks the judge for cited, categorical findings through `agent.stream()` with
 * structured output at temperature 0, then validates them. Never throws: a failed call becomes
 * `judgeError`.
 * @param model the judge model (replay, record or mock)
 * @param input the brief, the plan and the game
 */
export async function runJudge(
  model: LanguageModelV4,
  input: JudgeInput,
): Promise<Judged> {
  try {
    return await callJudge(model, input);
  } catch (error) {
    return {
      result: unjudged(input.spec.gameType, judgeError(error)),
      usage: ZERO_USAGE,
    };
  }
}
