import { describe, expect, it } from "vitest";
import { mulberry32, seedFromId, tapPlan } from "../../../src/eval/e2/bot.ts";
import {
  BOT_TAP_GAP_MAX_MS,
  BOT_TAP_GAP_MIN_MS,
  PROBE_VIEWPORT,
} from "../../../src/eval/e2/thresholds.ts";

describe("random-tap bot (§8.2 step 5)", () => {
  it("mulberry32 is deterministic and stays in [0, 1)", () => {
    const first = mulberry32(7);
    const second = mulberry32(7);
    const draws = Array.from({ length: 50 }, () => first());
    expect(draws).toEqual(Array.from({ length: 50 }, () => second()));
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(draws).size).toBeGreaterThan(45);
  });

  it("seeds from the item id, stably and distinctly", () => {
    expect(seedFromId("kb-01")).toBe(seedFromId("kb-01"));
    expect(seedFromId("kb-01")).not.toBe(seedFromId("kb-02"));
    expect(Number.isInteger(seedFromId("x"))).toBe(true);
  });

  it("plans taps inside the viewport with gaps inside the bounds", () => {
    const plan = tapPlan(mulberry32(seedFromId("good-arcade-run")), 40);
    expect(plan).toHaveLength(40);
    for (const tap of plan) {
      expect(tap.gapMs).toBeGreaterThanOrEqual(BOT_TAP_GAP_MIN_MS);
      expect(tap.gapMs).toBeLessThanOrEqual(BOT_TAP_GAP_MAX_MS);
      expect(tap.x).toBeGreaterThanOrEqual(0);
      expect(tap.x).toBeLessThan(PROBE_VIEWPORT.width);
      expect(tap.y).toBeGreaterThanOrEqual(0);
      expect(tap.y).toBeLessThan(PROBE_VIEWPORT.height);
    }
  });
});
