import {
  MAX_REPAIRS,
  REPAIR_TOKEN_BUDGET,
  RUN_TOKEN_BUDGET,
} from "./budgets.ts";
import type { BuildState } from "./schemas.ts";
import { toUsage, totalTokens, type ProviderUsage } from "./usage.ts";

/** The part of an agent step a stop condition reads. */
interface StepUsage {
  readonly usage?: ProviderUsage | undefined;
}

/**
 * True when a token budget is spent.
 * @param state current build state
 */
export function budgetSpent(state: BuildState): boolean {
  return (
    state.repairTokens >= REPAIR_TOKEN_BUDGET ||
    state.runTokens >= RUN_TOKEN_BUDGET
  );
}

/**
 * A per-step stop condition for a builder call (§4.4): the call stops after the first agent step
 * that brings the run, or the repair passes, to its token budget, so a pass overshoots a budget
 * by at most one step instead of a whole pass. `.dountil` then sees the spent budget.
 * @param state build state before the call
 * @returns a condition over the call's finished steps
 */
export function budgetStop(
  state: BuildState,
): (options: { readonly steps: readonly StepUsage[] }) => boolean {
  const repairing = state.buildAttempt > 0;
  return ({ steps }) => {
    const spent = steps.reduce(
      (sum, step) => sum + totalTokens(toUsage(step.usage ?? {})),
      0,
    );
    return budgetSpent({
      ...state,
      runTokens: state.runTokens + spent,
      repairTokens: state.repairTokens + (repairing ? spent : 0),
    });
  };
}

/**
 * The `.dountil` condition (§4.1): stop on a failure, a passing verdict, the repair cap or a spent
 * budget. The cap is read from `repairs`, never from Mastra's `iterationCount`.
 * @param state build state after a build-cycle pass
 */
export function shouldStopBuilding(state: BuildState): boolean {
  return (
    state.failure !== null ||
    state.verdict?.ok === true ||
    state.repairs >= MAX_REPAIRS ||
    budgetSpent(state)
  );
}

/**
 * Routes to `finalize` rather than `reject`.
 * @param state build state after the loop
 */
export function isFinalizable(state: BuildState): boolean {
  return state.failure === null && state.verdict?.ok === true;
}
