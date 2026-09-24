import { z } from "zod";
import {
  cardCitation,
  listAnchors,
  type AnchorEntry,
} from "../../cards/index.ts";
import { parseGame, type E1Context, type ParsedGame } from "./document.ts";
import { computeMetrics, type E1Metrics } from "./metrics.ts";
import { E1_RULES } from "./rules/index.ts";
import type { E1Rule, RuleSeverity, RuleStatus } from "./types.ts";

/** Default input card when no spec names one (§2.3). */
export const DEFAULT_INPUT_CARD = "tap-anywhere";
const SCORE_DECIMALS = 3;

export const Finding = z.object({
  ruleId: z.string(),
  severity: z.enum(["hard", "soft"]),
  message: z.string(),
  fix: z.string(),
  citation: z.string(),
});
export type Finding = z.infer<typeof Finding>;

/** The E1 verdict shared by the verify tool and the build-cycle (§2.3, §4.2). */
export const Verdict = z.object({
  ok: z.boolean(),
  score: z.number().min(0).max(1),
  errors: z.array(Finding),
  warnings: z.array(Finding),
});
export type Verdict = z.infer<typeof Verdict>;

/** One rule's outcome with its citation. */
export interface RuleResult {
  readonly ruleId: string;
  readonly severity: RuleSeverity;
  readonly status: RuleStatus;
  readonly message: string;
  readonly fix: string;
  readonly citation: string | null;
}

export interface E1Report {
  readonly verdict: Verdict;
  readonly results: readonly RuleResult[];
  readonly metrics: E1Metrics;
}

function citedCard(rule: E1Rule, game: ParsedGame): string | null {
  if (rule.card === "type") return game.declaredType;
  if (rule.card === "input") return game.spec?.input ?? DEFAULT_INPUT_CARD;
  return rule.card;
}

function citationFor(
  rule: E1Rule,
  game: ParsedGame,
  anchors: readonly AnchorEntry[],
): string | null {
  const card = citedCard(rule, game);
  const anchor = anchors.find(
    (entry) => entry.ruleId === rule.id && entry.card === card,
  );
  return anchor ? cardCitation(anchor) : null;
}

function runRule(
  rule: E1Rule,
  game: ParsedGame,
  anchors: readonly AnchorEntry[],
): RuleResult {
  const outcome = rule.check(game);
  return {
    ruleId: rule.id,
    severity: rule.severity,
    status: outcome.status,
    message: outcome.message ?? "",
    fix: rule.fix,
    citation: citationFor(rule, game, anchors),
  };
}

function toFinding(result: RuleResult): Finding {
  return {
    ruleId: result.ruleId,
    severity: result.severity,
    message: result.message,
    fix: result.fix,
    citation: result.citation ?? "",
  };
}

/**
 * Folds rule results into a verdict: ok means no hard failure; score is passed / applicable.
 * @param results rule results
 */
export function toVerdict(results: readonly RuleResult[]): Verdict {
  const applicable = results.filter((result) => result.status !== "n/a");
  const passed = applicable.filter((result) => result.status === "pass").length;
  const failed = applicable.filter((result) => result.status === "fail");
  const errors = failed
    .filter((result) => result.severity === "hard")
    .map(toFinding);
  const warnings = failed
    .filter((result) => result.severity === "soft")
    .map(toFinding);
  const raw = applicable.length === 0 ? 0 : passed / applicable.length;
  const score = Number(raw.toFixed(SCORE_DECIMALS));
  return { ok: errors.length === 0, score, errors, warnings };
}

/**
 * Scores a game page against every E1 rule. Pure apart from reading the cards for citations.
 * @param html the game document
 * @param context optional planned spec
 */
export function scoreGame(html: string, context: E1Context): E1Report {
  const game = parseGame(html, context);
  const anchors = listAnchors();
  const results = E1_RULES.map((rule) => runRule(rule, game, anchors));
  return {
    verdict: toVerdict(results),
    results,
    metrics: computeMetrics(game),
  };
}

/**
 * Evaluates a single rule; used by tests and by the rule-level CLI output.
 * @param ruleId rule id such as `E1-07`
 * @param html the game document
 * @param context optional planned spec
 */
export function evaluateRule(
  ruleId: string,
  html: string,
  context: E1Context,
): RuleResult {
  const rule = E1_RULES.find((candidate) => candidate.id === ruleId);
  if (!rule) throw new Error(`unknown rule: ${ruleId}`);
  return runRule(rule, parseGame(html, context), listAnchors());
}
