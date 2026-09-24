import { createStep } from "@mastra/core/workflows";
import type { ArtifactStore } from "../artifacts/types.ts";
import { CARTRIDGE_CHUNK } from "../events.ts";
import { runGenerate } from "../phases/generate.ts";
import type { AnyAgent, Emit } from "../phases/model-call.ts";
import { runVerify, type VerifyFn } from "../phases/verify.ts";
import { BuildState, CartridgeContext } from "../schemas.ts";

export interface BuildCycleDeps {
  readonly builder: AnyAgent;
  readonly artifacts: ArtifactStore;
  readonly verify: VerifyFn;
}

/**
 * The `.dountil` body (§4.1): one step that runs the generate phase and then the verify phase.
 * The first pass is the initial generation; every later pass is a repair.
 * @param deps builder agent, artifact store and scorer
 */
export function makeBuildCycleStep(deps: BuildCycleDeps) {
  return createStep({
    id: "build-cycle",
    inputSchema: BuildState,
    outputSchema: BuildState,
    requestContextSchema: CartridgeContext,
    execute: async ({ inputData, requestContext, writer }) => {
      const emit: Emit = (data) =>
        writer.custom({ type: CARTRIDGE_CHUNK, data });
      const generated = await runGenerate(inputData, {
        builder: deps.builder,
        artifacts: deps.artifacts,
        requestContext,
        emit,
      });
      return runVerify(generated, {
        artifacts: deps.artifacts,
        emit,
        verify: deps.verify,
      });
    },
  });
}
