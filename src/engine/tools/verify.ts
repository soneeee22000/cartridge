import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Verdict, scoreGame } from "../../eval/e1/score.ts";

/**
 * `verify`: the E1 scorer as a tool. Used by the eval CLI and tests; deliberately not given to the
 * builder, so the repair loop stays explicit and attributable (§4.3).
 */
export const verifyTool = createTool({
  id: "verify",
  description: "Score a game page against the E1 contract rules.",
  inputSchema: z.object({ html: z.string() }),
  outputSchema: Verdict,
  execute: ({ html }) => Promise.resolve(scoreGame(html, {}).verdict),
});
