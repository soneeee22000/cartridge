import { parseGame, type ParsedGame } from "../e1/document.ts";
import type { StringLiteral } from "../e1/scan.ts";

export interface ExtractOptions {
  /** The planned slug, excluded from the evidence. */
  readonly slug?: string | undefined;
}

/** Strings this short carry no language evidence (§10.2). */
const MIN_STRING_CHARS = 3;
const TEXT_SINKS =
  /\b(?:fillText|strokeText)\s*\(|\.(?:textContent|innerText|innerHTML)\s*=/g;
const NON_TEXT_BLOCKS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TAG_PATTERN = /<[^>]*>/g;
const TEMPLATE_HOLE = /\$\{[^}]*\}/g;
const NUMBER_TOKEN = /(?:^|\s)[-+]?\d+(?:[.,]\d+)?%?(?=\s|$)/g;
const WHITESPACE = /\s+/g;
const LETTER = /\p{L}/u;
const SPACE = /\s/;
const CSS_LIKE =
  /^#[0-9a-f]{3,8}$|\d(?:px|em|rem|vh|vw|dvh|deg)\b|\b(?:rgba?|hsla?)\(|\b(?:sans-serif|serif|monospace)\b|[:;]\s*[\w#-]+\s*;/i;
const IDENTIFIER_LIKE =
  /^[a-z][a-z0-9]*[A-Z]\w*$|^[a-z0-9]+(?:[-_][a-z0-9]+)+$|^[A-Z0-9_]{2,}$/;
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|#39|nbsp);/g;
const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function normalise(text: string): string {
  return text
    .replace(TAG_PATTERN, " ")
    .replace(ENTITY_PATTERN, (entity) => ENTITIES[entity] ?? entity)
    .replace(NUMBER_TOKEN, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

function isEvidence(text: string, options: ExtractOptions): boolean {
  if (text.length < MIN_STRING_CHARS || !LETTER.test(text)) return false;
  if (options.slug !== undefined && text === options.slug) return false;
  return !CSS_LIKE.test(text) && !IDENTIFIER_LIKE.test(text);
}

function markupStrings(game: ParsedGame): string[] {
  return game.markup
    .replace(NON_TEXT_BLOCKS, " ")
    .split(TAG_PATTERN)
    .map(normalise);
}

function sinkStarts(game: ParsedGame): Set<number> {
  const { masked } = game.code;
  const starts = new Set<number>();
  for (const match of masked.matchAll(TEXT_SINKS)) {
    let cursor = match.index + match[0].length;
    while (SPACE.test(masked[cursor] ?? "")) cursor += 1;
    starts.add(cursor);
  }
  return starts;
}

function literalText(literal: StringLiteral): string {
  const raw = literal.dynamic
    ? literal.value.replace(TEMPLATE_HOLE, " ")
    : literal.value;
  return normalise(raw);
}

function codeStrings(game: ParsedGame, options: ExtractOptions): string[] {
  const sinks = sinkStarts(game);
  return game.code.literals.flatMap((literal) => {
    const text = literalText(literal);
    const freeStanding = !sinks.has(literal.start);
    if (freeStanding && !SPACE.test(text)) return [];
    return isEvidence(text, options) ? [text] : [];
  });
}

/**
 * Extracts the visible UI strings a game shows (§10.2): text nodes outside `script`/`style`, the
 * literal arguments of `fillText`/`strokeText` and of `textContent`/`innerText`/`innerHTML`
 * assignments (tags stripped, template holes dropped), plus free-standing multi-word string
 * literals such as panel line arrays. The slug, identifiers, CSS, numbers and strings of two
 * characters or fewer are excluded.
 * @param html the game document
 * @param options the planned slug, when known
 * @returns distinct strings in first-seen order
 */
export function extractUiStrings(
  html: string,
  options: ExtractOptions = {},
): string[] {
  const game = parseGame(html, {});
  const markup = markupStrings(game).filter((text) =>
    isEvidence(text, options),
  );
  return [...new Set([...markup, ...codeStrings(game, options)])];
}
