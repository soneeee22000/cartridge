import { HOST_SOURCE } from "../../../contract/bridge.ts";
import {
  GAME_TYPE_RULES,
  forbiddenEvents,
  requiredEvents,
} from "../../../contract/game-types.ts";
import { sitesFor, type ParsedGame } from "../document.ts";
import { matchBracket } from "../scan.ts";
import {
  NOT_APPLICABLE,
  fail,
  passIf,
  type E1Rule,
  type RuleOutcome,
} from "../types.ts";
import { handlesReset } from "./bridge.ts";
import { listeners, listensFor } from "./helpers.ts";

/** How far after the `"reset"` literal the handler's call is looked for (arbitrary cap). */
const RESET_HANDLER_WINDOW_CHARS = 160;
const CALL_PATTERN = /([A-Za-z_$][\w$]*)\s*\(/g;
const BRANCH_LEAD = /[\s):]/;
const STATEMENT_END = /[;\n]/;
const CONTROL_EVENTS = [
  "click",
  "pointerdown",
  "pointerup",
  "touchstart",
] as const;

function checkRequired(game: ParsedGame): RuleOutcome {
  if (!game.declaredType) return NOT_APPLICABLE;
  const missing = requiredEvents(game.declaredType).filter(
    (event) => sitesFor(game, event).length === 0,
  );
  return passIf(
    missing.length === 0,
    `Required events never emitted: ${missing.join(", ")}.`,
  );
}

function checkForbidden(game: ParsedGame): RuleOutcome {
  if (!game.declaredType) return NOT_APPLICABLE;
  const present = forbiddenEvents(game.declaredType).filter(
    (event) => sitesFor(game, event).length > 0,
  );
  return passIf(
    present.length === 0,
    `Forbidden events emitted for ${game.declaredType}: ${present.join(", ")}.`,
  );
}

function checkEndReasons(game: ParsedGame): RuleOutcome {
  if (!game.declaredType) return NOT_APPLICABLE;
  const rules = GAME_TYPE_RULES[game.declaredType];
  if (rules.end === "forbidden") return NOT_APPLICABLE;
  const allowed: readonly string[] = rules.endReasons;
  const bad = sitesFor(game, "end")
    .map((site) => site.payload?.get("reason"))
    .flatMap((reason) =>
      reason?.kind === "string" && !allowed.includes(reason.value)
        ? [reason.value]
        : [],
    );
  return passIf(
    bad.length === 0,
    `end.reason not allowed for ${game.declaredType}: ${bad.join(", ")}.`,
  );
}

/** The code that runs when the `"reset"` test matches: a `{…}` block, or the statement up to `;` or newline. */
function resetBranch(masked: string, from: number): string {
  let cursor = from;
  while (BRANCH_LEAD.test(masked[cursor] ?? "")) cursor += 1;
  if (masked[cursor] === "{") {
    const close = matchBracket(masked, cursor);
    return masked.slice(cursor, close < 0 ? masked.length : close);
  }
  const limited = masked.slice(cursor, cursor + RESET_HANDLER_WINDOW_CHARS);
  return limited.split(STATEMENT_END)[0] ?? "";
}

function resetFunctions(game: ParsedGame): Set<string> {
  const names = new Set<string>();
  for (const literal of game.code.literals) {
    if (literal.dynamic || literal.value !== "reset") continue;
    const span = resetBranch(game.code.masked, literal.end);
    for (const match of span.matchAll(CALL_PATTERN))
      if (match[1]) names.add(match[1]);
  }
  return names;
}

function identifierPattern(name: string): string {
  return `(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`;
}

function controlCalls(game: ParsedGame, name: string): boolean {
  const identifier = identifierPattern(name);
  const events = CONTROL_EVENTS.join("|");
  const inline = new RegExp(
    `\\bon(?:${events})\\s*=\\s*["'][^"']*${identifier}\\s*\\(`,
    "i",
  );
  const property = new RegExp(
    `\\.on(?:${events})\\s*=\\s*[^;\\n]*${identifier}`,
  );
  if (inline.test(game.markup) || property.test(game.code.masked)) return true;
  const word = new RegExp(identifier);
  const controlEvents: readonly string[] = CONTROL_EVENTS;
  return listeners(game).some(
    (site) => controlEvents.includes(site.event) && word.test(site.handler),
  );
}

function checkClearTable(game: ParsedGame): RuleOutcome {
  if (game.declaredType !== "toy-box") return NOT_APPLICABLE;
  if (!handlesReset(game) || !listensFor(game, ["message"])) {
    return fail(`The game does not handle reset from "${HOST_SOURCE}".`);
  }
  const called = [...resetFunctions(game)];
  const shared = called.some((name) => controlCalls(game, name));
  return passIf(shared, clearTableMessage(called));
}

/** Names what the reset branch calls, so a repair wires that exact function to a control. */
function clearTableMessage(called: readonly string[]): string {
  const [first] = called;
  if (first === undefined)
    return "The reset branch calls no function; move the clear-the-table code into one function and call it there.";
  const names = called.map((name) => `${name}()`).join(", ");
  return `The reset branch calls ${names}, and no in-game control calls ${called.length === 1 ? "it" : "any of them"}. Make a visible control's click or pointer handler call ${first}() directly, or make the reset branch call the function the control already calls.`;
}

/** Rules cited by the declared type's card, plus the toy-box replay rule. */
export const TYPE_RULES: readonly E1Rule[] = [
  {
    id: "E1-15",
    severity: "hard",
    card: "type",
    fix: "Emit every event the type card marks required, at least once.",
    check: checkRequired,
  },
  {
    id: "E1-16",
    severity: "hard",
    card: "type",
    fix: "Remove every call site for an event the type card marks forbidden.",
    check: checkForbidden,
  },
  {
    id: "E1-17",
    severity: "soft",
    card: "type",
    fix: "Use only the end reasons the type card allows.",
    check: checkEndReasons,
  },
  {
    id: "E1-24",
    severity: "hard",
    card: "toy-box",
    fix: "Write one clear-the-table function, call it on the host reset command, and call it from a visible in-game control.",
    check: checkClearTable,
  },
];
