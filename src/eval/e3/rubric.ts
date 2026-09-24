import type { GameSpec } from "../../contract/spec.ts";
import { canonicalJson } from "../../models/request-key.ts";

export const DIMENSIONS = [
  "prompt-coverage",
  "goal-legibility",
  "feedback-on-input",
  "fail-state-clarity",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Categorical labels per dimension, best first. Labels are never converted to numbers (§10.1). */
export const DIMENSION_LABELS: Readonly<Record<Dimension, readonly string[]>> =
  {
    "prompt-coverage": ["covered", "partly", "missed"],
    "goal-legibility": ["stated", "implied", "absent"],
    "feedback-on-input": ["immediate", "indirect", "none"],
    "fail-state-clarity": ["explained", "abrupt", "missing"],
  };

/** The question each dimension asks about the game's source (newly authored). */
export const DIMENSION_QUESTIONS: Readonly<Record<Dimension, string>> = {
  "prompt-coverage":
    "Which nouns and verbs from the brief have a corresponding object, rule or action in the code?",
  "goal-legibility":
    "Is there on-screen text or a drawn cue that states what the player is trying to do?",
  "feedback-on-input":
    "Does a player input produce a visible change within the same handler or the next drawn frame?",
  "fail-state-clarity":
    "When play ends, does the game show why it ended and how to play again?",
};

function rubricLines(): string[] {
  return DIMENSIONS.map(
    (dimension) =>
      `- ${dimension}: ${DIMENSION_QUESTIONS[dimension]} Labels: ${DIMENSION_LABELS[dimension].join(", ")}.`,
  );
}

/** System instructions for the E3 judge. Contains no numbers and no volatile values. */
export const JUDGE_INSTRUCTIONS = [
  "You review the source code of a small HTML game against the brief it was built from.",
  "Answer each rubric question by reading the source. Do not run or imagine running the game.",
  "",
  "Rubric:",
  ...rubricLines(),
  "",
  "For every dimension, give one label from that dimension's list and evidence:",
  "each evidence item is a line number from the numbered source and a short quote copied exactly",
  "from that line. Give a one-sentence rationale in words only: never state a percentage, a ratio,",
  "a count out of a total, points, frames per second or milliseconds.",
  "Answer with one entry per dimension. If you cannot point to a line for a dimension, set that",
  "dimension to null rather than guessing. Give at most three evidence items per dimension.",
].join("\n");

/**
 * Prefixes each line with its 1-based number, as the judge sees the source.
 * @param html the game document
 */
export function numberLines(html: string): string {
  return html
    .split("\n")
    .map((line, index) => `${index + 1}| ${line}`)
    .join("\n");
}

/**
 * The judge's user message: the brief, the plan and the line-numbered source. Built only from
 * its inputs, so the cassette key is stable (§7.2).
 * @param prompt the brief
 * @param spec the planned game spec
 * @param html the game document
 */
export function judgeMessage(
  prompt: string,
  spec: GameSpec,
  html: string,
): string {
  return [
    "Brief:",
    prompt,
    "",
    "Plan:",
    canonicalJson(spec),
    "",
    "Game source (line-numbered):",
    numberLines(html),
  ].join("\n");
}
