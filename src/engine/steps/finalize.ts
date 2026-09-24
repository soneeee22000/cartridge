import { createStep } from "@mastra/core/workflows";
import type { ArtifactStore } from "../artifacts/types.ts";
import { BuildState, FinalizeOut } from "../schemas.ts";

/**
 * Packages a passing state (§4.2). Committing the result to the run row is the driver's job,
 * under the seal lease.
 * @param state a finalizable build state
 * @param artifacts the run's artifact store
 */
export async function finalize(
  state: BuildState,
  artifacts: ArtifactStore,
): Promise<FinalizeOut> {
  const { spec, artifact, verdict } = state;
  if (!spec || !artifact || !verdict?.ok)
    throw new Error("finalize reached without a passing artifact");
  const html = await artifacts.get(artifact);
  if (html === null)
    throw new Error(`artifact ${artifact.version} is missing from the store`);
  return {
    outcome: "passed",
    spec,
    artifact,
    html,
    verdict,
    history: state.history,
  };
}

/**
 * The `finalize` branch step.
 * @param artifacts the run's artifact store
 */
export function makeFinalizeStep(artifacts: ArtifactStore) {
  return createStep({
    id: "finalize",
    inputSchema: BuildState,
    outputSchema: FinalizeOut,
    execute: ({ inputData }) => finalize(inputData, artifacts),
  });
}
