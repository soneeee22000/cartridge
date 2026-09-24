import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ArtifactStore } from "../artifacts/types.ts";
import { readCartridgeContext } from "./context.ts";

/**
 * `load_draft`: the newest saved page for the run (§4.3).
 * @param artifacts the run's artifact store
 */
export function loadDraftTool(artifacts: ArtifactStore) {
  return createTool({
    id: "load_draft",
    description: "Load the newest saved draft of the game page, or null if none exists yet.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      draft: z.object({ version: z.string(), html: z.string() }).nullable(),
    }),
    execute: async (_input, context) => {
      const { runKey } = readCartridgeContext(context.requestContext);
      const latest = await artifacts.latest(runKey);
      return {
        draft: latest ? { version: latest.ref.version, html: latest.html } : null,
      };
    },
  });
}
