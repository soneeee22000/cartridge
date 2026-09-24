import { z } from "zod";
import type { GameType } from "../../contract/game-types.ts";
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./rubric.ts";

/** A quote shorter than this (after whitespace normalisation) is not evidence. */
export const E3_MIN_QUOTE_CHARS = 6;
/** A quote may sit this many lines away from the cited line. */
export const E3_LINE_TOLERANCE = 1;
/** A number followed by %, /n, "out of", "points", "fps" or "ms" is a numeric claim (§10.1). */
export const E3_NUMERIC_CLAIM =
  /\d+(?:[.,]\d+)?\s*(?:%|\/\s*\d+|(?:out of|points?|fps|ms)\b)/i;

const Evidence = z.object({ line: z.int(), quote: z.string() });

const Slot = z
  .object({
    label: z.string(),
    evidence: z.array(Evidence),
    rationale: z.string(),
  })
  .nullable();

/**
 * The judge's structured output (§10.1): exactly one nullable slot per dimension, so constrained
 * decoding cannot emit a dimension twice. Labels are checked per dimension in `discardReason`.
 */
export const JudgeOutput = z.object({
  "prompt-coverage": Slot,
  "goal-legibility": Slot,
  "feedback-on-input": Slot,
  "fail-state-clarity": Slot,
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;

/** One validated-shape finding: a filled slot together with its dimension. */
export interface JudgeFinding {
  readonly dimension: Dimension;
  readonly label: string;
  readonly evidence: readonly z.infer<typeof Evidence>[];
  readonly rationale: string;
}

/**
 * The filled slots, in rubric order.
 * @param output a parsed judge response
 */
export function findingsOf(output: JudgeOutput): JudgeFinding[] {
  return DIMENSIONS.flatMap((dimension) => {
    const slot = output[dimension];
    return slot ? [{ dimension, ...slot }] : [];
  });
}

export const DISCARD_REASONS = [
  "unknown-label",
  "no-evidence",
  "line-out-of-range",
  "quote-too-short",
  "quote-not-found",
  "numeric-claim",
] as const;
export type DiscardReason = (typeof DISCARD_REASONS)[number];

const DimensionValue = z.union([z.string(), z.literal("n/a"), z.null()]);

/** E3 per game: a label, `n/a` (does not apply) or `null` (not measured) per dimension. */
export const E3Result = z.object({
  dimensions: z.record(z.enum(DIMENSIONS), DimensionValue),
  discarded: z.array(
    z.object({
      dimension: z.enum(DIMENSIONS),
      reason: z.enum(DISCARD_REASONS),
    }),
  ),
  judgeError: z.string().nullable(),
});
export type E3Result = z.infer<typeof E3Result>;

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function evidenceReason(
  evidence: z.infer<typeof Evidence>,
  lines: readonly string[],
): DiscardReason | null {
  if (evidence.line < 1 || evidence.line > lines.length)
    return "line-out-of-range";
  const quote = squash(evidence.quote);
  if (quote.length < E3_MIN_QUOTE_CHARS) return "quote-too-short";
  const from = Math.max(0, evidence.line - 1 - E3_LINE_TOLERANCE);
  const nearby = lines.slice(from, evidence.line + E3_LINE_TOLERANCE);
  return nearby.some((line) => squash(line).includes(quote))
    ? null
    : "quote-not-found";
}

/**
 * Why a finding is discarded, or null when it survives (§10.1).
 * @param finding one judge finding
 * @param lines the game source split into lines
 */
export function discardReason(
  finding: JudgeFinding,
  lines: readonly string[],
): DiscardReason | null {
  if (!DIMENSION_LABELS[finding.dimension].includes(finding.label))
    return "unknown-label";
  if (finding.evidence.length === 0) return "no-evidence";
  for (const evidence of finding.evidence) {
    const reason = evidenceReason(evidence, lines);
    if (reason) return reason;
  }
  return E3_NUMERIC_CLAIM.test(finding.rationale) ? "numeric-claim" : null;
}

function appliesTo(dimension: Dimension, gameType: GameType): boolean {
  return !(dimension === "fail-state-clarity" && gameType === "toy-box");
}

function emptyDimensions(gameType: GameType): Record<Dimension, string | null> {
  return Object.fromEntries(
    DIMENSIONS.map((dimension) => [
      dimension,
      appliesTo(dimension, gameType) ? null : "n/a",
    ]),
  ) as Record<Dimension, string | null>;
}

/**
 * Folds a raw judge response into an `E3Result`. A dimension with no surviving finding is `null`,
 * never the worst label; `fail-state-clarity` is `n/a` for `toy-box`; an unparseable response makes every dimension `null` and records `judgeError`.
 * @param raw the judge's structured output, unvalidated
 * @param html the judged game
 * @param gameType the planned game type
 */
export function summariseJudgement(
  raw: unknown,
  html: string,
  gameType: GameType,
): E3Result {
  const dimensions = emptyDimensions(gameType);
  const parsed = JudgeOutput.safeParse(raw);
  if (!parsed.success)
    return {
      dimensions,
      discarded: [],
      judgeError: "unparseable judge response",
    };
  const lines = html.split("\n");
  const discarded: E3Result["discarded"] = [];
  for (const finding of findingsOf(parsed.data)) {
    if (!appliesTo(finding.dimension, gameType)) continue;
    const reason = discardReason(finding, lines);
    if (reason) discarded.push({ dimension: finding.dimension, reason });
    else dimensions[finding.dimension] ??= finding.label;
  }
  return { dimensions, discarded, judgeError: null };
}

/**
 * An E3 result for a game the judge could not see (a failed call, or no key and no cassette).
 * @param gameType the planned game type
 * @param error why the judge did not run
 */
export function unjudged(gameType: GameType, error: string): E3Result {
  return {
    dimensions: emptyDimensions(gameType),
    discarded: [],
    judgeError: error,
  };
}
