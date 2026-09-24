import { BRIDGE_EVENTS, type BridgeEvent } from "../../contract/game-types.ts";
import { sitesFor, type ParsedGame } from "./document.ts";
import { literalAfter } from "./rules/helpers.ts";

/** Reported, never scored (M-01 to M-04, §2.3). */
export interface E1Metrics {
  /** M-01: document size in bytes (UTF-8). */
  readonly bytes: number;
  /** M-02: number of inline scripts. */
  readonly inlineScripts: number;
  /** M-03: call-site count per bridge event. */
  readonly callSites: Readonly<Record<BridgeEvent, number>>;
  /** M-04: visible UI string count (input to E4). */
  readonly uiStrings: number;
}

const TEXT_SINKS =
  /\b(?:fillText|strokeText)\s*\(\s*|\.(?:textContent|innerText)\s*=\s*/g;
const BODY_PATTERN = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i;
const NON_TEXT_BLOCKS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TAG_PATTERN = /<[^>]+>/g;

function markupTextNodes(markup: string): number {
  const body = BODY_PATTERN.exec(markup)?.[1] ?? "";
  return body
    .replace(NON_TEXT_BLOCKS, " ")
    .split(TAG_PATTERN)
    .filter((text) => text.trim().length > 0).length;
}

function codeTextLiterals(game: ParsedGame): number {
  let count = 0;
  for (const match of game.code.masked.matchAll(TEXT_SINKS)) {
    if (literalAfter(game, match.index + match[0].length)) count += 1;
  }
  return count;
}

/**
 * Computes the E1 metrics for a parsed game.
 * @param game parsed game
 */
export function computeMetrics(game: ParsedGame): E1Metrics {
  const callSites = Object.fromEntries(
    BRIDGE_EVENTS.map((event) => [event, sitesFor(game, event).length]),
  ) as Record<BridgeEvent, number>;
  return {
    bytes: Buffer.byteLength(game.html, "utf8"),
    inlineScripts: game.scripts.filter(
      (script) => !script.external && script.kind !== "data",
    ).length,
    callSites,
    uiStrings: markupTextNodes(game.markup) + codeTextLiterals(game),
  };
}
