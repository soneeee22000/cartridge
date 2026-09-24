import { isGameType, type GameType } from "../../contract/game-types.ts";
import type { GameSpec } from "../../contract/spec.ts";
import {
  findCallSites,
  lexSource,
  type CallSite,
  type Lexed,
  type PayloadValue,
} from "./scan.ts";

/** One `<script>` element. */
export interface ScriptBlock {
  readonly kind: "classic" | "module" | "data";
  readonly external: boolean;
  readonly source: string;
}

/** Inputs every E1 rule receives. */
export interface E1Context {
  readonly spec?: GameSpec | undefined;
}

/** A game page parsed once and shared by every rule. */
export interface ParsedGame {
  readonly html: string;
  /** The page with script bodies and HTML comments blanked. */
  readonly markup: string;
  readonly htmlLang: string | null;
  readonly scripts: readonly ScriptBlock[];
  readonly code: Lexed;
  readonly callSites: readonly CallSite[];
  readonly bootPayload: ReadonlyMap<string, PayloadValue> | null;
  readonly declaredType: GameType | null;
  readonly spec: GameSpec | null;
}

const SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const CLASSIC_TYPES = new Set([
  "",
  "text/javascript",
  "application/javascript",
]);

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(attrs);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

function scriptKind(attrs: string): ScriptBlock["kind"] {
  const type = (attribute(attrs, "type") ?? "").trim().toLowerCase();
  if (type === "module") return "module";
  return CLASSIC_TYPES.has(type) ? "classic" : "data";
}

function readScripts(html: string): ScriptBlock[] {
  return [...html.matchAll(SCRIPT_PATTERN)].map((match) => ({
    kind: scriptKind(match[1] ?? ""),
    external: attribute(match[1] ?? "", "src") !== null,
    source: match[2] ?? "",
  }));
}

function blankRange(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

function toMarkup(html: string): string {
  return html
    .replace(
      SCRIPT_PATTERN,
      (_whole, attrs: string, body: string) =>
        `<script${attrs}>${blankRange(body)}</script>`,
    )
    .replace(HTML_COMMENT_PATTERN, blankRange);
}

function readHtmlLang(markup: string): string | null {
  const open = /<html\b([^>]*)>/i.exec(markup);
  return open ? attribute(open[1] ?? "", "lang") : null;
}

function bootLiteralType(
  bootPayload: ReadonlyMap<string, PayloadValue> | null,
): GameType | null {
  const value = bootPayload?.get("gameType");
  return value?.kind === "string" && isGameType(value.value)
    ? value.value
    : null;
}

/**
 * Parses a game page once for all E1 rules.
 * @param html the full game document
 * @param context optional planned spec
 */
export function parseGame(html: string, context: E1Context): ParsedGame {
  const markup = toMarkup(html);
  const scripts = readScripts(html);
  const code = lexSource(
    scripts
      .filter((script) => script.kind !== "data")
      .map((script) => script.source)
      .join("\n;\n"),
  );
  const callSites = findCallSites(code);
  const bootPayload =
    callSites.find((site) => site.event === "boot" && site.payload)?.payload ??
    null;
  const spec = context.spec ?? null;
  const declaredType = spec?.gameType ?? bootLiteralType(bootPayload);
  return {
    html,
    markup,
    htmlLang: readHtmlLang(markup),
    scripts,
    code,
    callSites,
    bootPayload,
    declaredType,
    spec,
  };
}

/**
 * Returns the call sites for one bridge event.
 * @param game parsed game
 * @param event event name
 */
export function sitesFor(game: ParsedGame, event: string): CallSite[] {
  return game.callSites.filter((site) => site.event === event);
}

/**
 * True when some string literal in the game's code equals one of the values.
 * @param game parsed game
 * @param values candidate literal values
 */
export function hasLiteral(game: ParsedGame, ...values: string[]): boolean {
  return game.code.literals.some(
    (literal) => !literal.dynamic && values.includes(literal.value),
  );
}
