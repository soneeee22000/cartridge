import type { ParsedGame } from "./document.ts";

export type RuleSeverity = "hard" | "soft";
export type RuleStatus = "pass" | "fail" | "n/a";

/**
 * The card a rule cites: a fixed card id, the declared type's card, or the input card
 * (`spec.input`, otherwise `tap-anywhere`).
 */
export type RuleCard = "game-page" | "bridge" | "toy-box" | "type" | "input";

export interface RuleOutcome {
  readonly status: RuleStatus;
  readonly message?: string;
}

/** One E1 rule: pure and deterministic, no I/O (§2.3). */
export interface E1Rule {
  readonly id: string;
  readonly severity: RuleSeverity;
  readonly card: RuleCard;
  /** Prescriptive hint passed verbatim to the repair prompt. */
  readonly fix: string;
  readonly check: (game: ParsedGame) => RuleOutcome;
}

export const PASS: RuleOutcome = { status: "pass" };
export const NOT_APPLICABLE: RuleOutcome = { status: "n/a" };

/**
 * Builds a failing outcome.
 * @param message what is wrong, in one sentence
 */
export function fail(message: string): RuleOutcome {
  return { status: "fail", message };
}

/**
 * Passes when the condition holds, otherwise fails with the message.
 * @param condition rule condition
 * @param message failure message
 */
export function passIf(condition: boolean, message: string): RuleOutcome {
  return condition ? PASS : fail(message);
}
