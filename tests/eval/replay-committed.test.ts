import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsArtifactStore } from "../../src/engine/artifacts/fs.ts";
import { systemClock } from "../../src/engine/clock.ts";
import { DATASET_PATH, loadDataset } from "../../src/eval/dataset/schema.ts";
import { REPO_ROOT } from "../../src/eval/matrix.ts";
import { generateItem } from "../../src/eval/run/generate.ts";
import { readRunRecord } from "../../src/eval/run/record.ts";
import { ONE_ITEM_ID } from "../../src/eval/tiers.ts";
import { createModel } from "../../src/models/port.ts";

const REPLAY_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 90_000;

describe("replay of a committed paid recording (§7.2)", () => {
  it(
    "regenerates the committed game byte for byte from its cassettes with no API key",
    async () => {
      const item = loadDataset(DATASET_PATH).items.find(
        (entry) => entry.id === ONE_ITEM_ID,
      );
      if (!item) throw new Error(`${ONE_ITEM_ID} is not in the dataset`);
      const committed = readRunRecord(join(REPO_ROOT, "games"), item.id);
      if (!committed?.artifact) throw new Error("no committed game to replay");
      const options = {
        cassetteDir: join(REPO_ROOT, "cassettes", item.id),
        env: {},
      };
      const gamesDir = mkdtempSync(join(tmpdir(), "cartridge-replay-"));
      const record = await generateItem(item, {
        models: {
          planner: createModel("planner", "replay", options),
          builder: createModel("builder", "replay", options),
        },
        artifacts: new FsArtifactStore(gamesDir),
        clock: systemClock,
        timeoutMs: REPLAY_TIMEOUT_MS,
      });
      expect(record.failure).toBeNull();
      expect(record.artifact).toEqual(committed.artifact);
      expect(record.spec).toEqual(committed.spec);
      expect(record.usage).toEqual(committed.usage);
      expect(record.buildAttempts).toBe(committed.buildAttempts);
      const replayed = readFileSync(
        join(gamesDir, item.id, `${committed.artifact.version}.html`),
        "utf8",
      );
      const original = readFileSync(
        join(REPO_ROOT, "games", item.id, `${committed.artifact.version}.html`),
        "utf8",
      );
      expect(replayed).toBe(original);
    },
    TEST_TIMEOUT_MS,
  );
});
