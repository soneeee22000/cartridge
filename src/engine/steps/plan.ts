import { createStep } from "@mastra/core/workflows";
import { GameSpec } from "../../contract/spec.ts";
import { detectLanguage } from "../../eval/e4/detect.ts";
import { failureFromError, stepFailure } from "../attribution.ts";
import {
  PLAN_MAX_STEPS,
  PLANNER_MAX_OUTPUT_TOKENS,
  PLANNER_THINKING,
} from "../budgets.ts";
import { CARTRIDGE_CHUNK } from "../events.ts";
import {
  consumeCall,
  type AnyAgent,
  type CallOutcome,
  type CartridgeRequestContext,
  type Emit,
} from "../phases/model-call.ts";
import { plannerMessage } from "../prompts/index.ts";
import {
  BuildState,
  CartridgeContext,
  RunInput,
  type StepFailure,
} from "../schemas.ts";
import { totalTokens, ZERO_USAGE } from "../usage.ts";

export interface PlanDeps {
  readonly planner: AnyAgent;
  readonly requestContext: CartridgeRequestContext;
  readonly emit: Emit;
}

const STRUCTURED_OUTPUT_ERROR_PREFIX = "STRUCTURED_OUTPUT";
const TRUNCATED_ERROR_ID = "STRUCTURED_OUTPUT_TRUNCATED";

interface PlannerCall extends CallOutcome {
  readonly object: unknown;
}

async function callPlanner(
  prompt: string,
  deps: PlanDeps,
): Promise<PlannerCall> {
  try {
    const output = await deps.planner.stream(plannerMessage(prompt), {
      structuredOutput: { schema: GameSpec },
      requestContext: deps.requestContext,
      maxSteps: PLAN_MAX_STEPS,
      modelSettings: { maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS },
      providerOptions: { anthropic: PLANNER_THINKING },
    });
    const call = await consumeCall(output, "plan", deps.emit);
    const object: unknown = await output.object.catch(() => null);
    return { ...call, object };
  } catch (error) {
    return { usage: ZERO_USAGE, finishReason: null, error, object: null };
  }
}

function isStructuredOutputError(error: unknown): boolean {
  const id = (error as { id?: unknown } | null)?.id;
  return (
    typeof id === "string" && id.startsWith(STRUCTURED_OUTPUT_ERROR_PREFIX)
  );
}

/**
 * With structured output, Mastra reports a cut or refused call as finishReason `error` and a
 * `STRUCTURED_OUTPUT_TRUNCATED` error whose `details.finishReason` holds the model's own reason.
 */
function finishReasonOf(call: PlannerCall): string | null {
  const error = call.error as
    { id?: unknown; details?: { finishReason?: unknown } } | undefined;
  const reported = error?.details?.finishReason;
  if (error?.id === TRUNCATED_ERROR_ID && typeof reported === "string")
    return reported;
  return call.finishReason;
}

function planFailure(call: PlannerCall): StepFailure | null {
  const finishReason = finishReasonOf(call);
  if (finishReason === "content-filter")
    return stepFailure(
      "plan",
      "model-refusal",
      "the planner call ended with content-filter",
    );
  if (finishReason === "length")
    return stepFailure(
      "plan",
      "plan-invalid-spec",
      "the planner call ended with finishReason length",
    );
  if (call.error !== undefined && !isStructuredOutputError(call.error))
    return failureFromError("plan", call.error);
  if (!GameSpec.safeParse(call.object).success)
    return stepFailure(
      "plan",
      "plan-invalid-spec",
      "the planner's output does not match GameSpec",
    );
  return null;
}

/**
 * The plan step (§4.2): fixes the UI language in code with the E4 detector, asks the planner for
 * a `GameSpec`, and keeps the planner's language only when the detector returns `unknown`.
 * @param input run key and prompt
 * @param deps planner agent, request context and progress writer
 */
export async function runPlan(
  input: RunInput,
  deps: PlanDeps,
): Promise<BuildState> {
  const detected = detectLanguage(input.prompt).lang;
  const call = await callPlanner(input.prompt, deps);
  await deps.emit({
    kind: "usage",
    data: { phase: "plan", buildAttempt: 0, usage: call.usage },
  });
  const failure = planFailure(call);
  const planned = failure ? null : GameSpec.parse(call.object);
  const langSource = detected === "unknown" ? "planner" : "detector";
  const spec =
    planned && detected !== "unknown"
      ? { ...planned, lang: detected }
      : planned;
  if (spec) await deps.emit({ kind: "plan.spec", data: { spec, langSource } });
  return {
    runKey: input.runKey,
    prompt: input.prompt,
    spec,
    langSource,
    planUsage: call.usage,
    buildAttempt: 0,
    repairs: 0,
    artifact: null,
    verdict: null,
    failure,
    runTokens: totalTokens(call.usage),
    repairTokens: 0,
    history: [],
  };
}

/**
 * Wraps `runPlan` as the workflow's first step.
 * @param planner the run's planner agent
 */
export function makePlanStep(planner: AnyAgent) {
  return createStep({
    id: "plan",
    inputSchema: RunInput,
    outputSchema: BuildState,
    requestContextSchema: CartridgeContext,
    execute: ({ inputData, requestContext, writer }) =>
      runPlan(inputData, {
        planner,
        requestContext,
        emit: (data) => writer.custom({ type: CARTRIDGE_CHUNK, data }),
      }),
  });
}
