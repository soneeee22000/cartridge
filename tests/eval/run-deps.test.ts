import { describe, expect, it } from "vitest";
import { e4Score } from "../../src/eval/e4/match.ts";
import { defaultEvalDeps } from "../../src/eval/run/deps.ts";
import { ITEM_TIMEOUT_MS } from "../../src/eval/run/generate.ts";

describe("default eval collaborators", () => {
  const deps = defaultEvalDeps({});

  it("uses the stateless mock models in mock mode and skips E3 there", () => {
    const models = deps.generatorModels("mock", "kite-over-roofs");
    expect(models.planner).toBeDefined();
    expect(models.builder).toBeDefined();
    expect(deps.judgeModel("mock", "kite-over-roofs")).toBeNull();
  });

  it("builds replay models with no key, one cassette directory per item", () => {
    expect(
      deps.generatorModels("replay", "kite-over-roofs").builder,
    ).toBeDefined();
    expect(deps.judgeModel("replay", "kite-over-roofs")).not.toBeNull();
  });

  it("refuses paid modes without a key", () => {
    expect(() => deps.generatorModels("record", "kite-over-roofs")).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("uses the §12.2 item timeout and reads the scorer sha from git", () => {
    expect(deps.timeoutMs).toBe(ITEM_TIMEOUT_MS);
    expect(deps.scorerSha()).toMatch(/^[0-9a-f]{7,}$|^unknown$/);
  });
});

describe("e4Score (§10.2)", () => {
  const base = { promptLang: "en" as const, htmlLang: "en", evidence: [] };

  it("is 1 for match, 0 for mismatch and null for abstain", () => {
    expect(e4Score({ ...base, verdict: "match", uiLang: "en" })).toBe(1);
    expect(e4Score({ ...base, verdict: "mismatch", uiLang: "fr" })).toBe(0);
    expect(e4Score({ ...base, verdict: "abstain", uiLang: null })).toBeNull();
  });
});
