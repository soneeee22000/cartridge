import { describe, expect, it } from "vitest";
import {
  ZERO_USAGE,
  addUsage,
  toUsage,
  totalTokens,
} from "../../src/engine/usage.ts";

describe("toUsage (§4.4)", () => {
  it("maps the observed example without counting cache reads twice", () => {
    expect(
      toUsage({ inputTokens: 14, outputTokens: 3, cachedInputTokens: 4 }),
    ).toEqual({ input: 10, output: 3, cacheRead: 4, cacheWrite: 0 });
  });

  it("subtracts cache writes, which the provider also folds into inputTokens", () => {
    expect(
      toUsage({
        inputTokens: 23,
        outputTokens: 7,
        cachedInputTokens: 4,
        cacheCreationInputTokens: 6,
      }),
    ).toEqual({ input: 13, output: 7, cacheRead: 4, cacheWrite: 6 });
  });

  it("treats missing fields as zero and never goes negative", () => {
    expect(toUsage({})).toEqual(ZERO_USAGE);
    expect(toUsage({ inputTokens: 1, cachedInputTokens: 5 }).input).toBe(0);
  });
});

describe("usage arithmetic", () => {
  it("adds kind by kind and totals all four kinds", () => {
    const sum = addUsage(
      { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
    );
    expect(sum).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44 });
    expect(totalTokens(sum)).toBe(110);
  });
});
