import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { FsArtifactStore } from "../../engine/artifacts/fs.ts";
import { ModelMode, MODEL_IDS } from "../../models/port.ts";
import {
  loadDataset,
  type Dataset,
  type DatasetItem,
} from "../dataset/schema.ts";
import type { E2Result } from "../e2/types.ts";
import { runJudge } from "../e3/judge.ts";
import { PRICE_TABLE_VERSION, USD_LABEL, priceUsage } from "../pricing.ts";
import { buildReport } from "../report/aggregate.ts";
import { serialiseReport } from "../report/json.ts";
import { renderMarkdown } from "../report/markdown.ts";
import type { ItemRecord } from "../report/types.ts";
import {
  estimateUsd,
  fullRunGuard,
  overBudget,
  resolveTier,
  selectItems,
  type Tier,
} from "../tiers.ts";
import type { EvalDeps } from "./deps.ts";
import { evaluateItem, type JudgeFn } from "./evaluate.ts";
import { generateItem } from "./generate.ts";
import {
  readE2,
  readGameHtml,
  readRunRecord,
  writeE2,
  writeRunRecord,
} from "./record.ts";

/** Output sinks, injectable for tests. */
export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const DEFAULT_LABEL = "latest";
const LABEL_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PAID_MODES: ReadonlySet<ModelMode> = new Set(["record", "live"]);
const GATED_TIERS: ReadonlySet<Tier> = new Set(["one", "sample"]);
const USD_DECIMALS = 2;

interface RunOptions {
  readonly tier: Tier;
  readonly mode: ModelMode;
  readonly label: string;
  readonly json: string | undefined;
  readonly maxUsd: number | null;
  readonly skipE2: boolean;
  readonly yes: boolean;
}

function parseRunArgs(args: string[]) {
  return parseArgs({
    args,
    options: {
      tier: { type: "string" },
      mode: { type: "string", default: "record" },
      label: { type: "string", default: DEFAULT_LABEL },
      json: { type: "string" },
      yes: { type: "boolean", default: false },
      "max-usd": { type: "string" },
      "skip-e2": { type: "boolean", default: false },
    },
    strict: true,
  }).values;
}

function readRunOptions(args: string[]): RunOptions | string {
  const values = parseRunArgs(args);
  const tier = resolveTier(values.tier ?? "");
  if (!tier) return "--tier must be one, sample, full, smoke1 or smoke";
  const mode = ModelMode.safeParse(values.mode);
  if (!mode.success) return "--mode must be live, record, replay or mock";
  if (!LABEL_PATTERN.test(values.label))
    return "--label must be lowercase kebab-case";
  const maxUsd =
    values["max-usd"] === undefined ? null : Number(values["max-usd"]);
  if (maxUsd !== null && !(maxUsd > 0))
    return "--max-usd must be a positive number";
  const options = {
    tier,
    mode: mode.data,
    label: values.label,
    json: values.json,
    maxUsd,
    skipE2: values["skip-e2"],
    yes: values.yes,
  };
  return fullRunGuard(tier, options) ?? options;
}

function paidModeProblem(mode: ModelMode, deps: EvalDeps): string | null {
  if (!PAID_MODES.has(mode)) return null;
  if (deps.pricesChecked === null)
    return "prices have not been re-checked against the official Anthropic pricing page (set PRICES_CHECKED_ON_OFFICIAL_PAGE in src/eval/pricing.ts first, §11.4)";
  return deps.env.ANTHROPIC_API_KEY
    ? null
    : `${mode} mode needs ANTHROPIC_API_KEY`;
}

function judgeFor(deps: EvalDeps, mode: ModelMode, runKey: string): JudgeFn {
  return async (input) => {
    const model = deps.judgeModel(mode, runKey);
    return model ? runJudge(model, input) : null;
  };
}

async function probeSafely(
  deps: EvalDeps,
  html: string,
  itemId: string,
  io: Io,
): Promise<E2Result | null> {
  try {
    return await deps.probe(html, itemId);
  } catch (error) {
    io.stderr(
      `E2 probe failed on ${itemId}; recorded as not probed: ${String(error)}\n`,
    );
    return null;
  }
}

async function runOneItem(
  item: DatasetItem,
  options: RunOptions,
  deps: EvalDeps,
  io: Io,
): Promise<ItemRecord> {
  const gamesDir = join(deps.root, "games");
  const record = await generateItem(item, {
    models: deps.generatorModels(options.mode, item.id),
    artifacts: new FsArtifactStore(gamesDir),
    clock: deps.clock,
    timeoutMs: deps.timeoutMs,
  });
  writeRunRecord(gamesDir, record);
  const html = readGameHtml(gamesDir, record);
  const e2 =
    html && !options.skipE2 ? await probeSafely(deps, html, item.id, io) : null;
  if (e2) writeE2(gamesDir, item.id, e2);
  return evaluateItem({
    item,
    record,
    html,
    e2,
    judge: judgeFor(deps, options.mode, item.id),
  });
}

function itemUsd(record: ItemRecord): number {
  return (
    priceUsage(MODEL_IDS.builder, record.usage.generator) +
    priceUsage(MODEL_IDS.judge, record.usage.judge)
  );
}

async function runItems(
  items: readonly DatasetItem[],
  options: RunOptions,
  deps: EvalDeps,
  io: Io,
): Promise<ItemRecord[]> {
  const records: ItemRecord[] = [];
  let spent = 0;
  for (const item of items) {
    if (overBudget(spent, options.maxUsd)) {
      io.stderr(
        `stopping before ${item.id}: the running estimate passed --max-usd\n`,
      );
      break;
    }
    const record = await runOneItem(item, options, deps, io);
    spent += itemUsd(record);
    io.stdout(
      `${item.id}: ${record.outcome}${record.failure ? ` (${record.failure.step}/${record.failure.code})` : ""}\n`,
    );
    records.push(record);
  }
  return records;
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function writeReports(
  dataset: Dataset,
  records: readonly ItemRecord[],
  options: RunOptions,
  deps: EvalDeps,
): void {
  const report = buildReport({
    tier: options.tier,
    label: options.label,
    datasetVersion: dataset.version,
    items: records,
  });
  const dir = join(deps.root, "reports", options.tier, options.label);
  const json = serialiseReport(report);
  writeText(
    join(dir, "report.md"),
    renderMarkdown(report, { scorerSha: deps.scorerSha() }),
  );
  writeText(join(dir, "report.json"), json);
  if (options.json) writeText(options.json, json);
}

/**
 * `run --tier <t> [--mode] [--label] [--json] [--yes --max-usd <n>] [--skip-e2]` (§12.2): prints the
 * cost estimate, generates each item and persists its game, `run.json` and `e2.json` before the
 * next one, then writes `reports/<tier>/<label>/report.{md,json}`.
 * @param args arguments after `run`
 * @param io output sinks
 * @param deps collaborators
 * @returns 0 when the run completes; 1 on a harness failure in `one`/`sample`; 2 on bad usage
 */
export async function runCommand(
  args: string[],
  io: Io,
  deps: EvalDeps,
): Promise<number> {
  const options = readRunOptions(args);
  if (typeof options === "string") {
    io.stderr(`${options}\n`);
    return EXIT_USAGE;
  }
  const paid = paidModeProblem(options.mode, deps);
  if (paid) {
    io.stderr(`${paid}\n`);
    return EXIT_USAGE;
  }
  const dataset = loadDataset(deps.datasetPath);
  const items = selectItems(dataset, options.tier);
  io.stdout(
    `estimate: ${items.length} items, about $${estimateUsd(items.length).toFixed(USD_DECIMALS)} (${USD_LABEL}; price table ${PRICE_TABLE_VERSION}); mode ${options.mode}\n`,
  );
  const records = await runItems(items, options, deps, io);
  writeReports(dataset, records, options, deps);
  const harness = records.some(
    (record) => record.outcome === "harness-failure",
  );
  return harness && GATED_TIERS.has(options.tier) ? EXIT_FAILED : EXIT_OK;
}

function parseRescoreArgs(args: string[]) {
  return parseArgs({
    args,
    options: {
      games: { type: "string" },
      tier: { type: "string", default: "full" },
      label: { type: "string", default: DEFAULT_LABEL },
      json: { type: "string" },
      "rerun-e2": { type: "boolean", default: false },
    },
    strict: true,
  }).values;
}

async function rescoreItem(
  item: DatasetItem,
  gamesDir: string,
  rerunE2: boolean,
  deps: EvalDeps,
  io: Io,
): Promise<ItemRecord | string> {
  const record = readRunRecord(gamesDir, item.id);
  if (!record) return `no run.json for ${item.id} under ${gamesDir}`;
  const html = readGameHtml(gamesDir, record);
  const e2 =
    rerunE2 && html
      ? await probeSafely(deps, html, item.id, io)
      : readE2(gamesDir, item.id);
  return evaluateItem({
    item,
    record,
    html,
    e2,
    judge: judgeFor(deps, "replay", item.id),
  });
}

/**
 * `score --games <dir> [--tier] [--label] [--json] [--rerun-e2]` (§11.3, §12.1): rescores committed
 * games with no key. E1 and E4 are recomputed, E3 is replayed from cassettes, and E2 and wall
 * times are read from `e2.json` and `run.json`. The JSON is byte-stable for CI's `diff -u`.
 * @param args arguments after `score`
 * @param io output sinks
 * @param deps collaborators
 */
export async function rescoreCommand(
  args: string[],
  io: Io,
  deps: EvalDeps,
): Promise<number> {
  const values = parseRescoreArgs(args);
  const tier = resolveTier(values.tier);
  if (!values.games || !tier) {
    io.stderr(
      "usage: cli.ts score --games <dir> [--tier one|sample|full] [--label <s>] [--json <path>] [--rerun-e2]\n",
    );
    return EXIT_USAGE;
  }
  const dataset = loadDataset(deps.datasetPath);
  const records: ItemRecord[] = [];
  for (const item of selectItems(dataset, tier)) {
    const record = await rescoreItem(
      item,
      values.games,
      values["rerun-e2"],
      deps,
      io,
    );
    if (typeof record === "string") {
      io.stderr(`${record}\n`);
      return EXIT_FAILED;
    }
    records.push(record);
  }
  const json = serialiseReport(
    buildReport({
      tier,
      label: values.label,
      datasetVersion: dataset.version,
      items: records,
    }),
  );
  if (values.json) writeText(values.json, json);
  else io.stdout(json);
  return EXIT_OK;
}
