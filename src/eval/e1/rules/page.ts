import { Script } from "node:vm";
import type { ParsedGame } from "../document.ts";
import { PASS, fail, passIf, type E1Rule, type RuleOutcome } from "../types.ts";
import { listensFor, literalAfter } from "./helpers.ts";

const EXTERNAL_URL = /^\s*(?:https?:|\/\/)/i;
const MARKUP_EXTERNAL_PATTERNS: readonly RegExp[] = [
  /\b(?:src|href)\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /url\(\s*["']?\s*(?:https?:|\/\/)/i,
  /@import\s+(?:url\(\s*)?["']?\s*(?:https?:|\/\/)/i,
];
const CODE_URL_SINKS = /\bimport\s*\(\s*|\.(?:src|href)\s*=\s*/g;
const CSS_URL_IN_STRING = /url\(\s*["']?\s*(?:https?:|\/\/)/i;
const BCP47_PATTERN = /^[a-z]{2,3}(?:-(?:[a-z]{2}|\d{3}))?$/i;
const META_PATTERN = /<meta\b[^>]*>/gi;
const NETWORK_API =
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b/;
const PERSISTENCE_API =
  /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\s*\.\s*cookie\b/;
const DYNAMIC_CODE =
  /\beval\s*\(|\bnew\s+Function\s*\(|\bset(?:Timeout|Interval)\s*\(\s*["'`]/;
const BLOCKING_DIALOG =
  /(?:^|[^.\w$])(?:alert|confirm|prompt)\s*\(|\bwindow\s*\.\s*(?:alert|confirm|prompt)\s*\(/;
const VIEWPORT_SIZE = /\b(?:innerWidth|innerHeight)\b/;
const VIEWPORT_UNITS = /\d(?:dvh|dvw|svh|lvh|vh|vw)\b/;

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function checkDocumentShape(game: ParsedGame): RuleOutcome {
  if (count(game.markup, /<!doctype\s+html\s*>/gi) !== 1)
    return fail("The page needs exactly one <!doctype html>.");
  if (
    count(game.markup, /<html\b/gi) !== 1 ||
    count(game.markup, /<\/html\s*>/gi) !== 1
  ) {
    return fail("The page needs exactly one <html>…</html> element.");
  }
  const iframeInCode = game.code.literals.some((literal) =>
    /<iframe\b/i.test(literal.value),
  );
  return passIf(
    !/<iframe\b/i.test(game.markup) && !iframeInCode,
    "The page embeds an <iframe>.",
  );
}

function codeLoadsExternal(game: ParsedGame): boolean {
  for (const match of game.code.masked.matchAll(CODE_URL_SINKS)) {
    const literal = literalAfter(game, match.index + match[0].length);
    if (literal && EXTERNAL_URL.test(literal.value)) return true;
  }
  return game.code.literals.some((literal) =>
    CSS_URL_IN_STRING.test(literal.value),
  );
}

function checkExternal(game: ParsedGame): RuleOutcome {
  const inMarkup = MARKUP_EXTERNAL_PATTERNS.some((pattern) =>
    pattern.test(game.markup),
  );
  return passIf(
    !inMarkup && !codeLoadsExternal(game),
    "The page references an external URL.",
  );
}

function checkLang(game: ParsedGame): RuleOutcome {
  if (game.htmlLang === null) return fail("<html> has no lang attribute.");
  return passIf(
    BCP47_PATTERN.test(game.htmlLang),
    `<html lang="${game.htmlLang}"> is not a well-formed language tag.`,
  );
}

function checkViewport(game: ParsedGame): RuleOutcome {
  const metas = game.markup.match(META_PATTERN) ?? [];
  const ok = metas.some(
    (meta) =>
      /name\s*=\s*["']?viewport/i.test(meta) &&
      /width\s*=\s*device-width/i.test(meta),
  );
  return passIf(ok, 'No <meta name="viewport"> with width=device-width.');
}

function checkScripts(game: ParsedGame): RuleOutcome {
  if (game.scripts.some((script) => script.kind === "module"))
    return fail('A <script type="module"> is present.');
  for (const [index, script] of game.scripts.entries()) {
    if (script.kind !== "classic") continue;
    try {
      new Script(script.source, { filename: `inline-script-${index + 1}.js` });
    } catch (error) {
      return fail(
        `Inline script ${index + 1} does not compile: ${(error as Error).message}`,
      );
    }
  }
  return PASS;
}

function checkLayout(game: ParsedGame): RuleOutcome {
  const adapts =
    listensFor(game, ["resize"]) ||
    VIEWPORT_SIZE.test(game.code.masked) ||
    VIEWPORT_UNITS.test(game.markup) ||
    game.code.literals.some((literal) => VIEWPORT_UNITS.test(literal.value));
  return passIf(
    adapts,
    "The layout never reads or reacts to the viewport size.",
  );
}

function codeFree(
  pattern: RegExp,
  message: string,
): (game: ParsedGame) => RuleOutcome {
  return (game) => passIf(!pattern.test(game.code.masked), message);
}

/** Rules cited by the `game-page` card. */
export const PAGE_RULES: readonly E1Rule[] = [
  {
    id: "E1-01",
    severity: "hard",
    card: "game-page",
    fix: "Ship one document: a single <!doctype html>, one <html>…</html>, and no <iframe>.",
    check: checkDocumentShape,
  },
  {
    id: "E1-02",
    severity: "hard",
    card: "game-page",
    fix: "Inline every asset; replace external URLs with code-drawn art or data: URIs.",
    check: checkExternal,
  },
  {
    id: "E1-03",
    severity: "hard",
    card: "game-page",
    fix: 'Set the UI language on the root element, e.g. <html lang="en">.',
    check: checkLang,
  },
  {
    id: "E1-04",
    severity: "soft",
    card: "game-page",
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the head.',
    check: checkViewport,
  },
  {
    id: "E1-05",
    severity: "hard",
    card: "game-page",
    fix: "Remove fetch, XMLHttpRequest, WebSocket, EventSource and sendBeacon; keep all data in the file.",
    check: codeFree(NETWORK_API, "The game uses a network API."),
  },
  {
    id: "E1-06",
    severity: "hard",
    card: "game-page",
    fix: "Remove localStorage, sessionStorage, indexedDB and document.cookie; keep state in memory.",
    check: codeFree(PERSISTENCE_API, "The game uses a persistence API."),
  },
  {
    id: "E1-07",
    severity: "hard",
    card: "game-page",
    fix: "Remove eval and new Function, and pass functions (not strings) to setTimeout/setInterval.",
    check: codeFree(DYNAMIC_CODE, "The game builds code at runtime."),
  },
  {
    id: "E1-08",
    severity: "soft",
    card: "game-page",
    fix: "Replace alert/confirm/prompt with messages drawn in the game.",
    check: codeFree(BLOCKING_DIALOG, "The game opens a blocking dialog."),
  },
  {
    id: "E1-09",
    severity: "hard",
    card: "game-page",
    fix: 'Use classic inline scripts (no type="module") and fix any syntax error.',
    check: checkScripts,
  },
  {
    id: "E1-23",
    severity: "soft",
    card: "game-page",
    fix: "Size the canvas from innerWidth/innerHeight and re-fit it on resize.",
    check: checkLayout,
  },
];
