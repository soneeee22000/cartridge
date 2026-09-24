import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createReplayHandler } from "../src/server/replay.ts";

/** Items whose real SSE transcripts feed the site's reducer tests: one repaired run, one first-pass run. */
export const SSE_FIXTURE_ITEMS = ["bubble-pop", "tile-sort"] as const;
/** Where the transcripts live, relative to the repo root. */
export const SSE_FIXTURE_DIR = join("site", "src", "data", "transcripts");

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const FAST_POLL_MS = 5;

/**
 * The exact SSE body `GET /api/replay?promptId=<id>` sends, replayed at instant pace.
 * @param root repo root holding the dataset, cassettes and reports
 * @param itemId a catalog item id
 */
export async function replayTranscript(
  root: string,
  itemId: string,
): Promise<string> {
  const handler = createReplayHandler({
    root,
    pace: "instant",
    relay: { pollMs: FAST_POLL_MS },
  });
  const response = await handler(
    new Request(`https://cartridge.test/api/replay?promptId=${itemId}`),
  );
  if (response.status !== 200)
    throw new Error(`replay of ${itemId} answered ${String(response.status)}`);
  return response.text();
}

/**
 * Path of one item's committed transcript.
 * @param root repo root
 * @param itemId a catalog item id
 */
export function fixturePath(root: string, itemId: string): string {
  return join(root, SSE_FIXTURE_DIR, `${itemId}.sse`);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  mkdirSync(join(REPO_ROOT, SSE_FIXTURE_DIR), { recursive: true });
  for (const itemId of SSE_FIXTURE_ITEMS) {
    const path = fixturePath(REPO_ROOT, itemId);
    writeFileSync(path, await replayTranscript(REPO_ROOT, itemId));
    process.stdout.write(`wrote ${path}\n`);
  }
}
