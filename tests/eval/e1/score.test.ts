import { describe, expect, it } from "vitest";
import { listAnchors, resolveAnchor } from "../../../src/cards/index.ts";
import { GAME_TYPES } from "../../../src/contract/game-types.ts";
import { INPUT_CARD_IDS } from "../../../src/contract/spec.ts";
import { E1_RULES } from "../../../src/eval/e1/rules/index.ts";
import {
  Verdict,
  evaluateRule,
  scoreGame,
} from "../../../src/eval/e1/score.ts";
import { game } from "./fixtures.ts";

const CITATION = /^cards\/[a-z-]+\.md:\d+$/;

describe("rule table (§2.3)", () => {
  it("has 24 uniquely numbered rules with fix hints", () => {
    expect(E1_RULES.map((rule) => rule.id)).toEqual(
      Array.from(
        { length: 24 },
        (_unused, index) => `E1-${String(index + 1).padStart(2, "0")}`,
      ),
    );
    for (const rule of E1_RULES) expect(rule.fix.length).toBeGreaterThan(10);
  });

  it("gives every rule exactly one anchor per citing card", () => {
    for (const rule of E1_RULES) {
      const cards =
        rule.card === "type"
          ? GAME_TYPES
          : rule.card === "input"
            ? INPUT_CARD_IDS
            : [rule.card];
      for (const card of cards)
        expect(resolveAnchor(rule.id, card).card).toBe(card);
      const all = listAnchors().filter((anchor) => anchor.ruleId === rule.id);
      expect(all).toHaveLength(cards.length);
    }
  });

  it("has no anchor that names an unknown rule", () => {
    const known = new Set(E1_RULES.map((rule) => rule.id));
    for (const anchor of listAnchors())
      expect(known.has(anchor.ruleId)).toBe(true);
  });

  it("rejects an unknown rule id", () => {
    expect(() => evaluateRule("E1-99", game(), {})).toThrow(/unknown rule/);
  });
});

describe("scoreGame", () => {
  it("passes a clean game with score 1", () => {
    const report = scoreGame(game(), {});
    expect(report.verdict).toEqual({
      ok: true,
      score: 1,
      errors: [],
      warnings: [],
    });
    expect(Verdict.parse(report.verdict)).toEqual(report.verdict);
  });

  it("gates on a hard failure and cites the card line", () => {
    const report = scoreGame(
      game("arcade-run", { extraScripts: '<script>fetch("/x");</script>' }),
      {},
    );
    expect(report.verdict.ok).toBe(false);
    const [finding] = report.verdict.errors;
    expect(finding?.ruleId).toBe("E1-05");
    expect(finding?.severity).toBe("hard");
    expect(finding?.citation).toMatch(CITATION);
    expect(finding?.citation).toContain("game-page");
    expect(finding?.fix.length).toBeGreaterThan(0);
  });

  it("keeps ok on soft failures and lists them as warnings", () => {
    const report = scoreGame(game("arcade-run", { viewport: "" }), {});
    expect(report.verdict.ok).toBe(true);
    expect(report.verdict.warnings.map((finding) => finding.ruleId)).toEqual([
      "E1-04",
    ]);
    expect(report.verdict.score).toBeLessThan(1);
  });

  it("scores passed over applicable and leaves n/a rules out", () => {
    const report = scoreGame(game("arcade-run", { viewport: "" }), {});
    const applicable = report.results.filter(
      (result) => result.status !== "n/a",
    );
    const passed = applicable.filter((result) => result.status === "pass");
    expect(report.verdict.score).toBeCloseTo(
      passed.length / applicable.length,
      3,
    );
  });

  it("cites the declared type card and the spec's input card", () => {
    const html = game("toy-box", {
      extra: "function clearTable() { score = 0; }",
      start: 'CARTRIDGE.send("start");',
    });
    const report = scoreGame(html, {
      spec: {
        title: "Bubble Tray",
        slug: "bubble-tray",
        lang: "en",
        gameType: "toy-box",
        loop: "Pop bubbles and watch the tally climb.",
        input: "drag-follow",
        style: "risograph",
      },
    });
    const byRule = new Map(
      [...report.verdict.errors, ...report.verdict.warnings].map((finding) => [
        finding.ruleId,
        finding.citation,
      ]),
    );
    expect(byRule.get("E1-24")).toMatch(/^cards\/toy-box\.md:/);
    expect(byRule.get("E1-22")).toMatch(/^cards\/drag-follow\.md:/);
  });

  it("reports the metrics", () => {
    const html = game();
    const { metrics } = scoreGame(html, {});
    expect(metrics.bytes).toBe(Buffer.byteLength(html, "utf8"));
    expect(metrics.inlineScripts).toBe(2);
    expect(metrics.callSites).toEqual({
      boot: 1,
      start: 1,
      score: 1,
      level: 0,
      end: 1,
    });
    expect(metrics.uiStrings).toBe(0);
    const labelled = game("toy-box", {
      extraScripts:
        '<script>ctx.fillText("Tally", 4, 4); hint.textContent = `Tap`; ctx.fillText(label, 1, 1);</script>',
    });
    expect(scoreGame(labelled, {}).metrics.uiStrings).toBe(3);
  });
});
