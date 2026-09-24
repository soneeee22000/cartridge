import { ZERO_USAGE, addUsage, type Usage } from "../../engine/usage.ts";
import { MODEL_IDS } from "../../models/port.ts";
import { LENGTH_BANDS, type LengthBand } from "../dataset/schema.ts";
import { DETECTOR_IDS } from "../e2/types.ts";
import { DIMENSIONS } from "../e3/rubric.ts";
import {
  LABELLED_NOTE,
  labelledSetStats,
  loadLabelledSet,
} from "../e4/labelled.ts";
import { PRICE_TABLE_VERSION, USD_LABEL, priceUsage } from "../pricing.ts";
import type { Tier } from "../tiers.ts";
import {
  REPORT_FORMAT,
  type BandRow,
  type ItemRecord,
  type ReportJson,
  type Totals,
} from "./types.ts";

export interface ReportInput {
  readonly tier: Tier;
  readonly label: string;
  readonly datasetVersion: string;
  readonly items: readonly ItemRecord[];
}

const PERCENT = 100;

/** Always out of scope (§11.3 section 6). */
const NOT_MEASURED: readonly string[] = [
  "fun or difficulty",
  "audio",
  "accessibility",
  "real-device performance",
  "multi-turn edits",
  "languages other than en/fr",
  "variance across repeated generations",
  "E3 agreement with human raters",
  "E4 accuracy beyond its 40 authored bundles",
  "E2 detection rates on generated games (the thresholds encode this repo's own fixture-based definitions)",
];

/** Tier-specific additions to the out-of-scope list. */
const NOT_MEASURED_BY_TIER: Readonly<Record<Tier, readonly string[]>> = {
  one: [
    "any band other than the single item's band",
    "any game type other than the single item's type",
  ],
  sample: [
    "differences between bands (one item per band)",
    "differences between game types (one item per type)",
  ],
  full: [],
};

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1
    ? upper
    : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

function outcomeCounts(items: readonly ItemRecord[]): Omit<Totals, "estUsd"> {
  const count = (outcome: ItemRecord["outcome"]) =>
    items.filter((item) => item.outcome === outcome).length;
  return {
    n: items.length,
    games: count("game"),
    contractFailed: count("contract-failed"),
    refusals: count("refusal"),
    harnessFailures: count("harness-failure"),
  };
}

function e1Stats(games: readonly ItemRecord[]): BandRow["e1"] {
  const scores = games.flatMap((item) =>
    item.e1Score === null ? [] : [item.e1Score],
  );
  if (scores.length === 0) return null;
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return { mean, min: Math.min(...scores) };
}

function e2Stats(games: readonly ItemRecord[]): BandRow["e2"] {
  const probed = games.flatMap((item) => (item.e2 ? [item.e2] : []));
  const failing = probed.flatMap((e2) =>
    DETECTOR_IDS.filter((id) => e2.detectors[id] === "fail"),
  );
  const passed = probed.filter((e2) =>
    DETECTOR_IDS.every((id) => e2.detectors[id] !== "fail"),
  ).length;
  return { probed: probed.length, passed, detectorFails: tally(failing) };
}

function e3Stats(games: readonly ItemRecord[]): BandRow["e3"] {
  const judged = games.flatMap((item) => (item.e3 ? [item.e3] : []));
  const entries = DIMENSIONS.map((dimension) => [
    dimension,
    tally(judged.map((e3) => e3.dimensions[dimension] ?? "null")),
  ]);
  return Object.fromEntries(entries) as BandRow["e3"];
}

function e4Stats(games: readonly ItemRecord[]): BandRow["e4"] {
  const verdicts = games.flatMap((item) => (item.e4 ? [item.e4.verdict] : []));
  const count = (verdict: string) =>
    verdicts.filter((value) => value === verdict).length;
  return {
    match: count("match"),
    mismatch: count("mismatch"),
    abstain: count("abstain"),
  };
}

function bandRow(band: LengthBand, items: readonly ItemRecord[]): BandRow {
  const inBand = items.filter((item) => item.lengthBand === band);
  const games = inBand.filter((item) => item.outcome === "game");
  return {
    band,
    ...outcomeCounts(inBand),
    e1: e1Stats(games),
    e2: e2Stats(games),
    e3: e3Stats(games),
    e4: e4Stats(games),
    medianBuildAttempts: median(games.map((item) => item.buildAttempts)),
  };
}

function sumUsage(usages: readonly Usage[]): Usage {
  return usages.reduce(addUsage, ZERO_USAGE);
}

function costOf(items: readonly ItemRecord[]): ReportJson["cost"] {
  const generator = sumUsage(items.map((item) => item.usage.generator));
  const judge = sumUsage(items.map((item) => item.usage.judge));
  const repairTokens = sumUsage(items.map((item) => item.repairUsage));
  const walls = items.flatMap((item) =>
    item.wallMs === null ? [] : [item.wallMs],
  );
  return {
    tokens: { generator, judge },
    repairTokens,
    repairCacheRead: repairTokens.cacheRead,
    estUsd:
      priceUsage(MODEL_IDS.builder, generator) +
      priceUsage(MODEL_IDS.judge, judge),
    usdLabel: USD_LABEL,
    wallMsTotal: walls.reduce((sum, wall) => sum + wall, 0),
    wallMsMedian: median(walls),
  };
}

function failuresOf(items: readonly ItemRecord[]): ReportJson["failures"] {
  const failures: Record<string, Record<string, number>> = {};
  for (const item of items) {
    if (!item.failure) continue;
    const byCode = (failures[item.failure.step] ??= {});
    byCode[item.failure.code] = (byCode[item.failure.code] ?? 0) + 1;
  }
  return failures;
}

/**
 * The §11.3 noise-floor note, sized by the smallest non-empty band.
 * @param bands per-band rows
 */
export function noiseFloor(bands: readonly BandRow[]): string {
  const sizes = bands.map((row) => row.n).filter((n) => n > 0);
  const smallest = sizes.length === 0 ? 1 : Math.min(...sizes);
  const points = Number((PERCENT / smallest).toFixed(1));
  const noun = smallest === 1 ? "item" : "items";
  return `One generation per item. With ${smallest} ${noun} per band, one item moves a band rate by ${points} points. Differences smaller than that are not interpretable.`;
}

function byId(left: ItemRecord, right: ItemRecord): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Aggregates item records into the report (§11.3): per-band rows with no cross-band quality mean,
 * repair loop, failures by attributed step, cost and latency, scope and noise floor.
 * @param input tier, label, dataset version and item records
 */
export function buildReport(input: ReportInput): ReportJson {
  const items = [...input.items].sort(byId);
  const bands = LENGTH_BANDS.map((band) => bandRow(band, items));
  const cost = costOf(items);
  return {
    format: REPORT_FORMAT,
    header: {
      tier: input.tier,
      label: input.label,
      datasetVersion: input.datasetVersion,
      models: { ...MODEL_IDS },
      priceTableVersion: PRICE_TABLE_VERSION,
    },
    bands,
    totals: { ...outcomeCounts(items), estUsd: cost.estUsd },
    repair: {
      histogram: tally(items.map((item) => String(item.buildAttempts))),
      triggers: tally(items.flatMap((item) => item.repairRules)),
    },
    failures: failuresOf(items),
    cost,
    e4Labelled: { ...labelledSetStats(loadLabelledSet()), note: LABELLED_NOTE },
    notMeasured: [...NOT_MEASURED, ...NOT_MEASURED_BY_TIER[input.tier]],
    noiseFloor: noiseFloor(bands),
    items,
  };
}
