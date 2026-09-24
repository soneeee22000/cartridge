import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SSE_FIXTURE_ITEMS,
  fixturePath,
  replayTranscript,
} from "../../scripts/site-sse-fixture.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPLAY_TIMEOUT_MS = 120_000;

describe("site SSE transcripts", () => {
  it(
    "match what /api/replay sends today, byte for byte",
    async () => {
      for (const itemId of SSE_FIXTURE_ITEMS) {
        const committed = readFileSync(fixturePath(REPO_ROOT, itemId), "utf8");
        expect(await replayTranscript(REPO_ROOT, itemId), itemId).toBe(
          committed,
        );
      }
    },
    REPLAY_TIMEOUT_MS,
  );
});
