import { describe, expect, it } from "vitest";
import { GAME_TYPES } from "../../src/contract/game-types.ts";
import {
  DATASET_PATH,
  LENGTH_BANDS,
  loadDataset,
} from "../../src/eval/dataset/schema.ts";
import {
  PRICE_TABLE,
  PRICE_TABLE_VERSION,
  USD_LABEL,
  priceUsage,
} from "../../src/eval/pricing.ts";
import {
  EST_ITEM_USAGE,
  ONE_ITEM_ID,
  SAMPLE_ITEM_IDS,
  estimateUsd,
  fullRunGuard,
  overBudget,
  resolveTier,
  selectItems,
} from "../../src/eval/tiers.ts";
import { MODEL_IDS } from "../../src/models/port.ts";

const dataset = loadDataset(DATASET_PATH);
const MILLION = 1_000_000;

describe("price table (§11.4)", () => {
  it("prices each usage kind at its own rate", () => {
    const usd = priceUsage(MODEL_IDS.builder, {
      input: MILLION,
      output: MILLION,
      cacheRead: MILLION,
      cacheWrite: MILLION,
    });
    const rates = PRICE_TABLE[MODEL_IDS.builder];
    expect(rates).toBeDefined();
    expect(usd).toBeCloseTo(
      (rates?.input ?? 0) +
        (rates?.output ?? 0) +
        (rates?.cacheRead ?? 0) +
        (rates?.cacheWrite ?? 0),
    );
  });

  it("covers every model the port can build, and carries a version and the estimate label", () => {
    for (const model of Object.values(MODEL_IDS))
      expect(PRICE_TABLE[model]).toBeDefined();
    expect(PRICE_TABLE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(USD_LABEL).toBe("estimate from list prices; not an invoice");
  });

  it("throws for a model with no price", () => {
    expect(() =>
      priceUsage("unpriced-model", {
        input: 1,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ).toThrow(/no price/);
  });
});

describe("tiers (§11.2)", () => {
  it("accepts the smoke aliases", () => {
    expect(resolveTier("smoke1")).toBe("one");
    expect(resolveTier("smoke")).toBe("sample");
    expect(resolveTier("full")).toBe("full");
    expect(resolveTier("everything")).toBeNull();
  });

  it("one is a single EN short-brief arcade-run item", () => {
    const [only, ...rest] = selectItems(dataset, "one");
    expect(rest).toHaveLength(0);
    expect(only?.id).toBe(ONE_ITEM_ID);
    expect(only?.lang).toBe("en");
    expect(only?.lengthBand).toBe("short-brief");
    expect(only?.intendedType).toBe("arcade-run");
  });

  it("sample covers each game type once and each length band once", () => {
    const items = selectItems(dataset, "sample");
    expect(items.map((entry) => entry.id)).toEqual([...SAMPLE_ITEM_IDS]);
    expect(new Set(items.map((entry) => entry.intendedType))).toEqual(
      new Set(GAME_TYPES),
    );
    expect(new Set(items.map((entry) => entry.lengthBand))).toEqual(
      new Set(LENGTH_BANDS),
    );
  });

  it("full is every item, sorted by id", () => {
    const ids = selectItems(dataset, "full").map((entry) => entry.id);
    expect(ids).toHaveLength(dataset.items.length);
    expect(ids).toEqual([...ids].sort());
  });

  it("throws when a tier names an id the dataset lacks", () => {
    expect(() => selectItems({ version: "v1", items: [] }, "one")).toThrow(
      ONE_ITEM_ID,
    );
  });

  it("estimates cost as items × the per-item usage, priced per model", () => {
    const perItem = Object.entries(EST_ITEM_USAGE).reduce(
      (sum, [model, usage]) => sum + priceUsage(model, usage),
      0,
    );
    expect(estimateUsd(4)).toBeCloseTo(4 * perItem);
    expect(estimateUsd(0)).toBe(0);
  });

  it("full refuses to start without --yes and --max-usd", () => {
    expect(fullRunGuard("full", { yes: false, maxUsd: 5 })).toMatch(/--yes/);
    expect(fullRunGuard("full", { yes: true, maxUsd: null })).toMatch(
      /--max-usd/,
    );
    expect(fullRunGuard("full", { yes: true, maxUsd: 5 })).toBeNull();
    expect(fullRunGuard("sample", { yes: false, maxUsd: null })).toBeNull();
  });

  it("stops before the next item once spend passes the cap", () => {
    expect(overBudget(2.5, 2)).toBe(true);
    expect(overBudget(1.5, 2)).toBe(false);
    expect(overBudget(99, null)).toBe(false);
  });
});
