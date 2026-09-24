import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { GameSpec } from "../../contract/spec.ts";
import { Usage } from "../../engine/usage.ts";
import { canonicalJson } from "../../models/request-key.ts";
import { E2Result } from "../e2/types.ts";
import { ItemFailure } from "../report/types.ts";

export const RUN_RECORD_FORMAT = "cartridge-run/1";
export const RUN_FILE = "run.json";
export const E2_FILE = "e2.json";
const JSON_INDENT = 2;

/** `games/<runKey>/run.json`: what one generation did, written the moment it settles (§12.2). */
export const RunRecord = z.object({
  format: z.literal(RUN_RECORD_FORMAT),
  itemId: z.string(),
  status: z.string(),
  failure: ItemFailure.nullable(),
  spec: GameSpec.nullable(),
  artifact: z
    .object({ version: z.string(), sha256: z.string(), bytes: z.int() })
    .nullable(),
  buildAttempts: z.int().min(0),
  repairRules: z.array(z.string()),
  usage: z.object({ plan: Usage, generate: Usage, repair: Usage }),
  wallMs: z.number().min(0),
  models: z.object({ planner: z.string(), builder: z.string() }),
  priceTableVersion: z.string(),
});
export type RunRecord = z.infer<typeof RunRecord>;

function writeSorted(path: string, value: unknown): void {
  const sorted: unknown = JSON.parse(canonicalJson(value));
  writeFileSync(path, `${JSON.stringify(sorted, null, JSON_INDENT)}\n`);
}

/**
 * The item's directory under `games/`.
 * @param gamesDir the games root
 * @param itemId dataset item id (the run key)
 */
export function itemDir(gamesDir: string, itemId: string): string {
  return join(gamesDir, itemId);
}

/**
 * Writes `run.json` with sorted keys.
 * @param gamesDir the games root
 * @param record the settled run
 */
export function writeRunRecord(gamesDir: string, record: RunRecord): void {
  const dir = itemDir(gamesDir, record.itemId);
  mkdirSync(dir, { recursive: true });
  writeSorted(join(dir, RUN_FILE), RunRecord.parse(record));
}

/**
 * Reads `run.json`, or null when the item was never run.
 * @param gamesDir the games root
 * @param itemId dataset item id
 */
export function readRunRecord(
  gamesDir: string,
  itemId: string,
): RunRecord | null {
  const path = join(itemDir(gamesDir, itemId), RUN_FILE);
  if (!existsSync(path)) return null;
  return RunRecord.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Reads the committed game for a settled run, or null when there is none.
 * @param gamesDir the games root
 * @param record the settled run
 */
export function readGameHtml(
  gamesDir: string,
  record: RunRecord,
): string | null {
  if (!record.artifact) return null;
  const path = join(
    itemDir(gamesDir, record.itemId),
    `${record.artifact.version}.html`,
  );
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/**
 * Writes `e2.json` the moment the probe finishes (§8.3).
 * @param gamesDir the games root
 * @param itemId dataset item id
 * @param result the probe result
 */
export function writeE2(
  gamesDir: string,
  itemId: string,
  result: E2Result,
): void {
  const dir = itemDir(gamesDir, itemId);
  mkdirSync(dir, { recursive: true });
  writeSorted(join(dir, E2_FILE), E2Result.parse(result));
}

/**
 * Reads `e2.json`, or null when the game was never probed.
 * @param gamesDir the games root
 * @param itemId dataset item id
 */
export function readE2(gamesDir: string, itemId: string): E2Result | null {
  const path = join(itemDir(gamesDir, itemId), E2_FILE);
  if (!existsSync(path)) return null;
  return E2Result.parse(JSON.parse(readFileSync(path, "utf8")));
}
