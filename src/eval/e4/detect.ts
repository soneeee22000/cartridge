import { WORDS_EN } from "./words-en.ts";
import { WORDS_FR } from "./words-fr.ts";

export type DetectedLang = "en" | "fr" | "unknown";

export interface Detection {
  readonly lang: DetectedLang;
  /** |English hits − French hits|. */
  readonly margin: number;
}

/** Smallest hit difference that decides a language. Starting value, not tuned. */
export const DETECT_MIN_MARGIN = 1;
const WORD_PATTERN = /[a-zàâäçéèêëîïôöùûüÿœæ]+/g;

/**
 * Counts authored function words on word boundaries and picks the language with more hits
 * (§10.2). The plan step and E4 share this function.
 * @param text any text: a prompt or extracted UI strings
 */
export function detectLanguage(text: string): Detection {
  const words = text.toLowerCase().match(WORD_PATTERN) ?? [];
  const english = words.filter((word) => WORDS_EN.has(word)).length;
  const french = words.filter((word) => WORDS_FR.has(word)).length;
  const margin = Math.abs(english - french);
  if (margin < DETECT_MIN_MARGIN) return { lang: "unknown", margin };
  return { lang: english > french ? "en" : "fr", margin };
}
