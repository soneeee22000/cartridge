import type { ParsedGame } from "../document.ts";
import { matchBracket, type StringLiteral } from "../scan.ts";

const LISTENER_PATTERN = /\baddEventListener\s*\(\s*/g;
const SPACE_PATTERN = /\s/;

/**
 * Returns the static string literal that starts at or after `index` (skipping spaces), if any.
 * @param game parsed game
 * @param index position in the combined script source
 */
export function literalAfter(
  game: ParsedGame,
  index: number,
): StringLiteral | null {
  let cursor = index;
  while (SPACE_PATTERN.test(game.code.masked[cursor] ?? "")) cursor += 1;
  const literal = game.code.literalAt.get(cursor);
  return literal && !literal.dynamic ? literal : null;
}

/** A registered listener: the event name and the masked text of its handler argument. */
export interface ListenerSite {
  readonly event: string;
  readonly handler: string;
}

/**
 * Lists `addEventListener("<event>", …)` registrations with a static event name.
 * @param game parsed game
 */
export function listeners(game: ParsedGame): ListenerSite[] {
  const { masked } = game.code;
  const sites: ListenerSite[] = [];
  for (const match of masked.matchAll(LISTENER_PATTERN)) {
    const literal = literalAfter(game, match.index + match[0].length);
    if (!literal) continue;
    const open = masked.indexOf("(", match.index);
    const close = matchBracket(masked, open);
    const handler = masked.slice(
      literal.end,
      close < 0 ? masked.length : close - 1,
    );
    sites.push({ event: literal.value, handler });
  }
  return sites;
}

/**
 * True when the game listens for any of the events, via `addEventListener` or an `on<event>` property.
 * @param game parsed game
 * @param events DOM event names
 */
export function listensFor(
  game: ParsedGame,
  events: readonly string[],
): boolean {
  if (listeners(game).some((site) => events.includes(site.event))) return true;
  const property = new RegExp(`\\.on(?:${events.join("|")})\\s*=`);
  return property.test(game.code.masked);
}
