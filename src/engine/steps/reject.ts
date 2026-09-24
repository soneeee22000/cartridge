import { createStep } from "@mastra/core/workflows";
import { attributionFromState } from "../attribution.ts";
import { BuildState, RejectOut } from "../schemas.ts";

/**
 * Packages a failed state with its attribution (§4.5).
 * @param state build state after the loop
 */
export function reject(state: BuildState): RejectOut {
  return {
    outcome: "rejected",
    spec: state.spec,
    attribution: attributionFromState(state),
    history: state.history,
  };
}

/** The `reject` branch step. */
export function makeRejectStep() {
  return createStep({
    id: "reject",
    inputSchema: BuildState,
    outputSchema: RejectOut,
    execute: ({ inputData }) => Promise.resolve(reject(inputData)),
  });
}
