import { assetRoot } from "../src/cards/index.ts";
import { toNodeHandler } from "../src/server/node-adapter.ts";
import { createReplayHandler } from "../src/server/replay.ts";

/** `GET /api/replay?promptId=`: keyless cassette replay of one dataset item, as SSE (ADR-0003). */
export const GET = createReplayHandler({ root: assetRoot() });

export default toNodeHandler(GET);
