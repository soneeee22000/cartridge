import type { Usage } from "../engine/usage.ts";
import { MODEL_IDS } from "../models/port.ts";
import type { Dataset, DatasetItem } from "./dataset/schema.ts";
import { priceUsage } from "./pricing.ts";

export const TIERS = ["one", "sample", "full"] as const;
export type Tier = (typeof TIERS)[number];


/** The `one` tier: an EN short-brief item whose intended type is `arcade-run`. */
export const ONE_ITEM_ID = "kite-over-roofs";

/** The `sample` tier: each game type intended once, each length band once. */
export const SAMPLE_ITEM_IDS: readonly string[] = [
  "bubble-pop",
  "kite-over-roofs",
  "maze-de-haies",
  "phare-long",
];

/**
 * Per-item usage by model for the pre-run cost estimate: the rounded per-item mean of the `sample`
 * tier as recorded in the full run of 2026-09-24 (`reports/committed/sample.json`, four items). A test keeps the two
 * in step. Cache kinds are zero because no request sets a cache breakpoint.
 */
export const EST_ITEM_USAGE: Readonly<Record<string, Usage>> = {
  [MODEL_IDS.builder]: {
    input: 30_590,
    output: 8_698,
    cacheRead: 0,
    cacheWrite: 0,
  },
  [MODEL_IDS.judge]: {
    input: 8_510,
    output: 712,
    cacheRead: 0,
    cacheWrite: 0,
  },
};

/**
 * Resolves a tier name.
 * @param name `one`, `sample` or `full`
 * @returns the tier, or null when unknown
 */
export function resolveTier(name: string): Tier | null {
  return TIERS.find((tier) => tier === name) ?? null;
}

function pick(dataset: Dataset, ids: readonly string[]): DatasetItem[] {
  return ids.map((id) => {
    const item = dataset.items.find((entry) => entry.id === id);
    if (!item) throw new Error(`tier names ${id}, which is not in the dataset`);
    return item;
  });
}

/**
 * The items a tier runs, in a stable order.
 * @param dataset the loaded dataset
 * @param tier which tier
 */
export function selectItems(dataset: Dataset, tier: Tier): DatasetItem[] {
  if (tier === "one") return pick(dataset, [ONE_ITEM_ID]);
  if (tier === "sample") return pick(dataset, SAMPLE_ITEM_IDS);
  return [...dataset.items].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

/**
 * Pre-run estimate: items × the per-item usage, priced per model (§11.2).
 * @param items number of items
 * @returns estimated USD
 */
export function estimateUsd(items: number): number {
  const perItem = Object.entries(EST_ITEM_USAGE).reduce(
    (sum, [model, usage]) => sum + priceUsage(model, usage),
    0,
  );
  return items * perItem;
}

/**
 * `full` refuses to start without `--yes` and `--max-usd` (§11.2).
 * @param tier requested tier
 * @param flags parsed flags
 * @returns an error message, or null when the run may start
 */
export function fullRunGuard(
  tier: Tier,
  flags: { readonly yes: boolean; readonly maxUsd: number | null },
): string | null {
  if (tier !== "full") return null;
  if (!flags.yes) return "the full tier needs --yes";
  if (flags.maxUsd === null) return "the full tier needs --max-usd <n>";
  return null;
}

/**
 * True once the running estimate has passed the cap, so the next item must not start.
 * @param spentUsd running estimate so far
 * @param maxUsd cap, or null for none
 */
export function overBudget(spentUsd: number, maxUsd: number | null): boolean {
  return maxUsd !== null && spentUsd > maxUsd;
}
