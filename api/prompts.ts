import { assetRoot } from "../src/cards/index.ts";
import { toNodeHandler } from "../src/server/node-adapter.ts";
import { createPromptsHandler } from "../src/server/replay.ts";

/** `GET /api/prompts`: the dataset items that can be replayed. */
export const GET = createPromptsHandler({ root: assetRoot() });

export default toNodeHandler(GET);
