import { createWorkflow } from "@mastra/core/workflows";
import type { ArtifactStore } from "./artifacts/types.ts";
import type { AnyAgent } from "./phases/model-call.ts";
import type { VerifyFn } from "./phases/verify.ts";
import { CartridgeContext, RunInput, RunOutput } from "./schemas.ts";
import { makeBuildCycleStep } from "./steps/build-cycle.ts";
import { makeFinalizeStep } from "./steps/finalize.ts";
import { makePlanStep } from "./steps/plan.ts";
import { makeRejectStep } from "./steps/reject.ts";
import { isFinalizable, shouldStopBuilding } from "./stop-rules.ts";

export * from "./schemas.ts";

export const WORKFLOW_ID = "cartridge-run";

export interface WorkflowDeps {
  readonly planner: AnyAgent;
  readonly builder: AnyAgent;
  readonly artifacts: ArtifactStore;
  readonly verify: VerifyFn;
}

/**
 * The graph (§4.1): plan, then `build-cycle` until the stop rule holds, then `finalize` or
 * `reject`. Built per run so every step closes over that run's agents and artifact store (§4.6).
 * @param deps the run's agents, artifact store and scorer
 */
export function buildCartridgeWorkflow(deps: WorkflowDeps) {
  return createWorkflow({
    id: WORKFLOW_ID,
    inputSchema: RunInput,
    outputSchema: RunOutput,
    requestContextSchema: CartridgeContext,
    options: { autoRestartActiveRuns: false },
  })
    .then(makePlanStep(deps.planner))
    .dountil(makeBuildCycleStep(deps), ({ inputData }) =>
      Promise.resolve(shouldStopBuilding(inputData)),
    )
    .branch([
      [
        ({ inputData }) => Promise.resolve(isFinalizable(inputData)),
        makeFinalizeStep(deps.artifacts),
      ],
      [
        ({ inputData }) => Promise.resolve(!isFinalizable(inputData)),
        makeRejectStep(),
      ],
    ])
    .commit();
}

export type CartridgeWorkflow = ReturnType<typeof buildCartridgeWorkflow>;
