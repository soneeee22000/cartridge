import type { GameSpec } from "../../contract/spec.ts";
import type { ArtifactStore } from "../artifacts/types.ts";
import { failureFromError, stepFailure } from "../attribution.ts";
import {
  BUILDER_MAX_OUTPUT_TOKENS,
  BUILDER_THINKING,
  GENERATE_MAX_STEPS,
} from "../budgets.ts";
import { builderMessage } from "../prompts/index.ts";
import { budgetStop } from "../stop-rules.ts";
import type {
  ArtifactRef,
  AttemptRec,
  BuildState,
  StepFailure,
} from "../schemas.ts";
import { totalTokens, ZERO_USAGE } from "../usage.ts";
import {
  consumeCall,
  type AnyAgent,
  type CallOutcome,
  type CartridgeRequestContext,
  type Emit,
} from "./model-call.ts";

export interface GenerateDeps {
  readonly builder: AnyAgent;
  readonly artifacts: ArtifactStore;
  readonly requestContext: CartridgeRequestContext;
  readonly emit: Emit;
}

async function callBuilder(
  spec: GameSpec,
  state: BuildState,
  deps: GenerateDeps,
): Promise<CallOutcome> {
  const repairVerdict = state.buildAttempt === 0 ? null : state.verdict;
  try {
    const output = await deps.builder.stream(
      builderMessage(spec, repairVerdict),
      {
        requestContext: deps.requestContext,
        maxSteps: GENERATE_MAX_STEPS,
        stopWhen: budgetStop(state),
        modelSettings: { maxOutputTokens: BUILDER_MAX_OUTPUT_TOKENS },
        providerOptions: { anthropic: BUILDER_THINKING },
      },
    );
    return await consumeCall(output, "generate", deps.emit);
  } catch (error) {
    return { usage: ZERO_USAGE, finishReason: null, error };
  }
}

async function savedArtifact(
  state: BuildState,
  artifacts: ArtifactStore,
): Promise<ArtifactRef | null> {
  const latest = await artifacts.latest(state.runKey);
  return latest?.ref.buildAttempt === state.buildAttempt ? latest.ref : null;
}

function generateFailure(
  call: CallOutcome,
  artifact: ArtifactRef | null,
): StepFailure | null {
  if (call.error !== undefined) return failureFromError("generate", call.error);
  if (call.finishReason === "content-filter")
    return stepFailure(
      "generate",
      "model-refusal",
      "the builder call ended with content-filter",
    );
  if (call.finishReason === "length")
    return stepFailure(
      "generate",
      "generate-truncated",
      "the builder call ended with finishReason length",
    );
  if (!artifact)
    return stepFailure(
      "generate",
      "generate-no-artifact",
      "the builder saved no draft in this attempt",
    );
  return null;
}

/**
 * The generate phase (§4.2): one builder call, then the artifact is read from the store for
 * `(runKey, buildAttempt)`, never from model text. Every expected failure lands in
 * `state.failure`; nothing is thrown.
 * @param state build state before the pass
 * @param deps builder agent, artifact store, request context and progress writer
 */
export async function runGenerate(
  state: BuildState,
  deps: GenerateDeps,
): Promise<BuildState> {
  if (state.failure || !state.spec) return state;
  const mode = state.buildAttempt === 0 ? "initial" : "repair";
  const repairOf =
    mode === "repair"
      ? (state.verdict?.errors.map((finding) => finding.ruleId) ?? [])
      : [];
  const { buildAttempt } = state;
  if (mode === "repair")
    await deps.emit({
      kind: "repair.start",
      data: { buildAttempt, fromRules: repairOf },
    });
  await deps.emit({
    kind: "phase.start",
    data: { phase: "generate", buildAttempt },
  });
  deps.requestContext.set("buildAttempt", buildAttempt);
  const call = await callBuilder(state.spec, state, deps);
  const artifact = await savedArtifact(state, deps.artifacts);
  await deps.emit({
    kind: "usage",
    data: { phase: "generate", buildAttempt, usage: call.usage },
  });
  const attempt: AttemptRec = {
    buildAttempt,
    mode,
    artifact,
    verdict: null,
    usage: call.usage,
    finishReason: call.finishReason,
    repairOf,
  };
  const tokens = totalTokens(call.usage);
  return {
    ...state,
    artifact,
    failure: generateFailure(call, artifact),
    repairs: state.repairs + (mode === "repair" ? 1 : 0),
    runTokens: state.runTokens + tokens,
    repairTokens: state.repairTokens + (mode === "repair" ? tokens : 0),
    history: [...state.history, attempt],
  };
}
