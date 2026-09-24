import type { GameSpec } from "../../contract/spec.ts";
import { scoreGame, type Verdict } from "../../eval/e1/score.ts";
import type { ArtifactStore } from "../artifacts/types.ts";
import { stepFailure } from "../attribution.ts";
import type { ArtifactRef, BuildState } from "../schemas.ts";
import type { Emit } from "./model-call.ts";

/** Scores a page; the default is the E1 scorer, the same function the `verify` tool wraps. */
export type VerifyFn = (html: string, context: { spec: GameSpec }) => Verdict;

/** The E1 verdict for a page and its planned spec. */
export const e1Verify: VerifyFn = (html, context) =>
  scoreGame(html, context).verdict;

export interface VerifyDeps {
  readonly artifacts: ArtifactStore;
  readonly emit: Emit;
  readonly verify: VerifyFn;
}

async function scoreArtifact(
  ref: ArtifactRef,
  spec: GameSpec,
  deps: VerifyDeps,
): Promise<Verdict> {
  const html = await deps.artifacts.get(ref);
  if (html === null)
    throw new Error(`artifact ${ref.version} is missing from the store`);
  return deps.verify(html, { spec });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The verify phase (§4.2): scores the artifact, stores the verdict on the state and on the last
 * attempt, then moves to the next build attempt. Skipped when a failure is already recorded.
 * @param state build state after generate
 * @param deps artifact store, progress writer and scorer
 */
export async function runVerify(
  state: BuildState,
  deps: VerifyDeps,
): Promise<BuildState> {
  if (state.failure || !state.artifact || !state.spec) return state;
  const { buildAttempt } = state;
  await deps.emit({
    kind: "phase.start",
    data: { phase: "verify", buildAttempt },
  });
  let verdict: Verdict;
  try {
    verdict = await scoreArtifact(state.artifact, state.spec, deps);
  } catch (error) {
    return {
      ...state,
      failure: stepFailure(
        "verify-static",
        "verifier-crashed",
        describe(error),
      ),
    };
  }
  const errors = verdict.errors.map((finding) => finding.ruleId);
  await deps.emit({
    kind: "verify.verdict",
    data: { buildAttempt, ok: verdict.ok, score: verdict.score, errors },
  });
  const history = state.history.map((attempt) =>
    attempt.buildAttempt === buildAttempt ? { ...attempt, verdict } : attempt,
  );
  return { ...state, verdict, history, buildAttempt: buildAttempt + 1 };
}
