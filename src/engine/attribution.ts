import { APICallError } from "@ai-sdk/provider";
import { CassetteMissError } from "../models/cassette.ts";
import type {
  Attribution,
  BuildState,
  FailureCode,
  StepFailure,
} from "./schemas.ts";
import { budgetSpent } from "./stop-rules.ts";

export { Attribution } from "./schemas.ts";

type ModelStep = "plan" | "generate";
type DriverCode =
  | "stream-cut"
  | "lease-lost"
  | "engine-crashed"
  | "model-error"
  | "cassette-miss";

const MAX_CAUSE_DEPTH = 8;
const DRIVER_RETRYABLE: Readonly<Record<DriverCode, boolean>> = {
  "stream-cut": true,
  "lease-lost": true,
  "engine-crashed": false,
  "model-error": false,
  "cassette-miss": false,
};

function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && chain.length < MAX_CAUSE_DEPTH) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function describe(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

interface ThrownClass {
  readonly code: "cassette-miss" | "model-error" | null;
  readonly message: string;
  readonly retryable: boolean;
}

function classifyThrown(error: unknown): ThrownClass {
  const chain = causes(error);
  if (chain.some((entry) => entry instanceof CassetteMissError))
    return {
      code: "cassette-miss",
      message: describe(error),
      retryable: false,
    };
  const apiError = chain.find((entry) => APICallError.isInstance(entry));
  if (apiError && APICallError.isInstance(apiError)) {
    const status = apiError.statusCode ?? "none";
    const message = `status ${status}: ${apiError.message}`;
    return { code: "model-error", message, retryable: apiError.isRetryable };
  }
  return { code: null, message: describe(error), retryable: false };
}

/**
 * Converts an error thrown by a model call into a `StepFailure` (§4.5). `CassetteMissError` is
 * matched with `instanceof` along the cause chain; `APICallError` keeps its `isRetryable`.
 * @param step the phase that made the call
 * @param error what was thrown or reported
 */
export function failureFromError(step: ModelStep, error: unknown): StepFailure {
  const thrown = classifyThrown(error);
  if (thrown.code) return { step, ...thrown, code: thrown.code };
  return {
    step,
    code: "model-error",
    message: `unclassified: ${thrown.message}`,
    retryable: false,
  };
}

/**
 * Classifies an error that escaped the workflow and reached the driver (§5.4): a cassette miss or
 * a model API error keeps its code, anything else is `engine-crashed`.
 * @param error what was thrown
 * @param buildAttempt last known build attempt
 */
export function attributionForThrown(
  error: unknown,
  buildAttempt = 0,
): Attribution {
  const thrown = classifyThrown(error);
  const code = thrown.code ?? "engine-crashed";
  return {
    step: "driver",
    code,
    buildAttempt,
    ruleIds: [],
    message: thrown.message,
    retryable: thrown.retryable,
  };
}

/**
 * Builds a step failure for a code that is not an exception.
 * @param step failing step
 * @param code failure code
 * @param message what happened
 */
export function stepFailure(
  step: StepFailure["step"],
  code: FailureCode,
  message: string,
): StepFailure {
  return { step, code, message, retryable: false };
}

/**
 * The reject step's attribution (§4.5): the recorded failure if any; otherwise a spent budget, or
 * an unmet contract blamed on generate with the remaining hard rule ids.
 * @param state build state after the loop
 */
export function attributionFromState(state: BuildState): Attribution {
  const { failure } = state;
  if (failure)
    return { ...failure, buildAttempt: state.buildAttempt, ruleIds: [] };
  const buildAttempt = state.history.at(-1)?.buildAttempt ?? state.buildAttempt;
  const ruleIds = state.verdict?.errors.map((finding) => finding.ruleId) ?? [];
  if (budgetSpent(state))
    return {
      step: "generate",
      code: "budget-exhausted",
      buildAttempt,
      ruleIds,
      message: `token budget spent (run ${state.runTokens}, repair ${state.repairTokens})`,
      retryable: false,
    };
  return {
    step: "generate",
    code: "contract-unmet",
    buildAttempt,
    ruleIds,
    message: `hard rules still failing after ${state.repairs} repairs`,
    retryable: false,
  };
}

/**
 * An attribution for what the driver sees outside the workflow.
 * @param code driver-level code
 * @param message what happened
 * @param buildAttempt last known build attempt
 */
export function driverAttribution(
  code: DriverCode,
  message: string,
  buildAttempt = 0,
): Attribution {
  return {
    step: "driver",
    code,
    buildAttempt,
    ruleIds: [],
    message,
    retryable: DRIVER_RETRYABLE[code],
  };
}
