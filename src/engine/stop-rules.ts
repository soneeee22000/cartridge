import {
  MAX_REPAIRS,
  REPAIR_TOKEN_BUDGET,
  RUN_TOKEN_BUDGET,
} from "./budgets.ts";
import type { BuildState } from "./schemas.ts";

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
