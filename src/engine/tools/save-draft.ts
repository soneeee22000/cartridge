import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ArtifactStore } from "../artifacts/types.ts";
import { MAX_GAME_BYTES } from "../budgets.ts";
import { readCartridgeContext } from "./context.ts";

const PageHtml = z
  .string()
  .min(1)
  .refine((html) => Buffer.byteLength(html, "utf8") <= MAX_GAME_BYTES, {
    message: `the page must be at most ${MAX_GAME_BYTES} bytes`,
  });

/**
 * `save_draft`: stores the whole page for this build attempt, overwriting an earlier save in the
 * same attempt. The result carries no run id, so replays are byte-identical (§4.3).
 * @param artifacts the run's artifact store
 */
export function saveDraftTool(artifacts: ArtifactStore) {
  return createTool({
    id: "save_draft",
    description:
      "Save the complete game page (one HTML document). Saving again in the same attempt replaces it.",
    inputSchema: z.object({ html: PageHtml }),
    outputSchema: z.object({
      version: z.string(),
      bytes: z.int(),
      sha256: z.string(),
    }),
    execute: async ({ html }, context) => {
      const { runKey, buildAttempt } = readCartridgeContext(context.requestContext);
      const ref = await artifacts.put(runKey, buildAttempt, html);
      return { version: ref.version, bytes: ref.bytes, sha256: ref.sha256 };
    },
  });
}
