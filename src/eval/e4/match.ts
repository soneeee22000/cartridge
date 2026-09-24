import { z } from "zod";
import { parseGame } from "../e1/document.ts";
import { detectLanguage } from "./detect.ts";
import { extractUiStrings } from "./extract-ui-strings.ts";

/** Fewer distinct UI strings than this: abstain. Starting value, set on the labelled set. */
export const E4_MIN_STRINGS = 4;
/** Fewer letters across the UI strings than this: abstain. Starting value, set on the labelled set. */
export const E4_MIN_LETTERS = 30;
/** A detector margin below this: abstain. Starting value, set on the labelled set. */
export const E4_MIN_MARGIN = 2;

const LETTERS = /\p{L}/gu;

export type AbstainReason = "few-strings" | "few-letters" | "low-margin";

export type Classification =
  | { readonly lang: "en" | "fr"; readonly margin: number }
  | {
      readonly lang: "abstain";
      readonly reason: AbstainReason;
      readonly margin: number;
    };

export const E4Result = z.object({
  verdict: z.enum(["match", "mismatch", "abstain"]),
  promptLang: z.enum(["en", "fr"]),
  uiLang: z.enum(["en", "fr"]).nullable(),
  htmlLang: z.string().nullable(),
  evidence: z.array(z.string()),
});
export type E4Result = z.infer<typeof E4Result>;

/**
 * Decides the language of a bundle of UI strings, or abstains below the evidence floor (§10.2).
 * @param strings UI strings
 */
export function classifyStrings(strings: readonly string[]): Classification {
  const distinct = [...new Set(strings)];
  const text = distinct.join("\n");
  const detected = detectLanguage(text);
  const margin = detected.margin;
  if (distinct.length < E4_MIN_STRINGS)
    return { lang: "abstain", reason: "few-strings", margin };
  if ((text.match(LETTERS) ?? []).length < E4_MIN_LETTERS)
    return { lang: "abstain", reason: "few-letters", margin };
  if (detected.lang === "unknown" || margin < E4_MIN_MARGIN)
    return { lang: "abstain", reason: "low-margin", margin };
  return { lang: detected.lang, margin };
}

/**
 * E4 (§10.2): the prompt's language against the language of the game's UI strings. The score is
 * 1 for `match`, 0 for `mismatch` and null for `abstain`, which never counts as a pass.
 * @param promptLang the item's language
 * @param html the game document
 * @param slug the planned slug, excluded from the evidence
 */
export function matchLanguage(
  promptLang: "en" | "fr",
  html: string,
  slug?: string,
): E4Result {
  const evidence = extractUiStrings(html, { slug });
  const classified = classifyStrings(evidence);
  const htmlLang = parseGame(html, {}).htmlLang;
  if (classified.lang === "abstain")
    return { verdict: "abstain", promptLang, uiLang: null, htmlLang, evidence };
  const verdict = classified.lang === promptLang ? "match" : "mismatch";
  return { verdict, promptLang, uiLang: classified.lang, htmlLang, evidence };
}

/**
 * The E4 score: 1, 0, or null for an abstention.
 * @param result an E4 result
 */
export function e4Score(result: E4Result): number | null {
  if (result.verdict === "abstain") return null;
  return result.verdict === "match" ? 1 : 0;
}
