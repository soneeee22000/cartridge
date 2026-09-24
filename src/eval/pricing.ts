import type { Usage } from "../engine/usage.ts";

/**
 * Price table version (§11.4). Input and output rates match the claude-api skill's model table
 * (cached 2026-06-24), read on 2026-09-24; cache rates come from research `deploy-and-models.md`
 * §2.2. A price change means a new version string; old reports keep the version they were priced with.
 */
export const PRICE_TABLE_VERSION = "2026-09-24";

/**
 * Date the table was re-checked against the official Anthropic pricing page, or `null` if it has
 * not been. The eval CLI refuses paid modes (`record`, `live`) while this is `null` (§11.4, §14 S4).
 */
export const PRICES_CHECKED_ON_OFFICIAL_PAGE: string | null = null;

/** Every USD figure carries this label (§0.1). */
export const USD_LABEL = "estimate from list prices; not an invoice";

/** USD per million tokens, one rate per disjoint usage kind (§4.4). */
export interface Rates {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

const TOKENS_PER_PRICE_UNIT = 1_000_000;

/** List prices by model id; `cacheWrite` is the 5-minute cache write rate. */
export const PRICE_TABLE: Readonly<Record<string, Rates>> = {
  "claude-sonnet-5": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.2,
    cacheWrite: 2.5,
  },
  "claude-haiku-4-5": {
    input: 1.0,
    output: 5.0,
    cacheRead: 0.1,
    cacheWrite: 1.25,
  },
};

/**
 * Prices one usage record, each kind at its own rate. Throws for a model with no price.
 * @param model model id
 * @param usage disjoint token counts
 * @returns estimated USD
 */
export function priceUsage(model: string, usage: Usage): number {
  const rates = PRICE_TABLE[model];
  if (!rates) throw new Error(`no price for model ${model}`);
  const weighted =
    usage.input * rates.input +
    usage.output * rates.output +
    usage.cacheRead * rates.cacheRead +
    usage.cacheWrite * rates.cacheWrite;
  return weighted / TOKENS_PER_PRICE_UNIT;
}
