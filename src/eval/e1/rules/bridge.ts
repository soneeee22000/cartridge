import {
  BRIDGE_SOURCE,
  BRIDGE_VERSION,
  HOST_SOURCE,
} from "../../../contract/bridge.ts";
import { isGameType } from "../../../contract/game-types.ts";
import { hasLiteral, sitesFor, type ParsedGame } from "../document.ts";
import { matchBracket } from "../scan.ts";
import {
  NOT_APPLICABLE,
  PASS,
  fail,
  passIf,
  type E1Rule,
  type RuleOutcome,
} from "../types.ts";
import { listensFor, literalAfter } from "./helpers.ts";

const HELPER_PATTERN = /\bCARTRIDGE\s*=\s*\{/;
const BOOT_KEYS = ["title", "gameType", "lang"] as const;

function helperBody(game: ParsedGame): [number, number] | null {
  const match = HELPER_PATTERN.exec(game.code.masked);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = matchBracket(game.code.masked, open);
  return close < 0 ? null : [open, close];
}

function checkHelper(game: ParsedGame): RuleOutcome {
  const body = helperBody(game);
  if (!body) return fail("The CARTRIDGE helper is not defined.");
  const masked = game.code.masked.slice(0, body[1]);
  const sourceField = /\bsource\s*:\s*/g;
  sourceField.lastIndex = body[0];
  const field = sourceField.exec(masked);
  const sourceValue = field
    ? literalAfter(game, field.index + field[0].length)?.value
    : undefined;
  if (sourceValue !== BRIDGE_SOURCE)
    return fail(`The helper does not stamp source: "${BRIDGE_SOURCE}".`);
  const version = new RegExp(`\\bv\\s*:\\s*${BRIDGE_VERSION}\\b`);
  return passIf(
    version.test(masked.slice(body[0])),
    `The helper does not stamp v: ${BRIDGE_VERSION}.`,
  );
}

function checkBoot(game: ParsedGame): RuleOutcome {
  const boots = sitesFor(game, "boot");
  if (boots.length === 0) return fail("boot is never emitted.");
  const complete = boots.some((site) =>
    BOOT_KEYS.every((key) => site.payload?.has(key)),
  );
  if (complete) return PASS;
  const missing = BOOT_KEYS.filter((key) => !boots[0]?.payload?.has(key));
  return fail(`The boot payload is missing: ${missing.join(", ")}.`);
}

function checkBootLang(game: ParsedGame): RuleOutcome {
  const lang = game.bootPayload?.get("lang");
  if (lang?.kind !== "string") return NOT_APPLICABLE;
  return passIf(
    lang.value === game.htmlLang,
    `boot.lang "${lang.value}" differs from <html lang="${game.htmlLang ?? ""}">.`,
  );
}

function checkBootType(game: ParsedGame): RuleOutcome {
  const value = game.bootPayload?.get("gameType");
  if (value?.kind !== "string")
    return fail("boot.gameType is not a string literal.");
  if (!isGameType(value.value))
    return fail(`boot.gameType "${value.value}" is not a known game type.`);
  const planned = game.spec?.gameType;
  if (planned && planned !== value.value)
    return fail(
      `boot.gameType "${value.value}" differs from the planned "${planned}".`,
    );
  return PASS;
}

function checkScoreValue(game: ParsedGame): RuleOutcome {
  const scores = sitesFor(game, "score");
  if (scores.length === 0) return NOT_APPLICABLE;
  const quoted = scores.some(
    (site) => site.payload?.get("value")?.kind === "string",
  );
  return passIf(!quoted, "score.value is sent as a string literal.");
}

function checkLevelIndex(game: ParsedGame): RuleOutcome {
  const levels = sitesFor(game, "level");
  if (levels.length === 0) return NOT_APPLICABLE;
  return passIf(
    levels.every((site) => site.payload?.has("index") === true),
    "A level call has no index key.",
  );
}

function handlesHost(game: ParsedGame, ...commands: string[]): boolean {
  return (
    listensFor(game, ["message"]) &&
    hasLiteral(game, HOST_SOURCE) &&
    commands.every((command) => hasLiteral(game, command))
  );
}

function checkPauseResume(game: ParsedGame): RuleOutcome {
  return passIf(
    handlesHost(game, "pause", "resume"),
    "The game does not handle pause and resume from the host.",
  );
}

function checkReset(game: ParsedGame): RuleOutcome {
  if (game.declaredType === "toy-box") return NOT_APPLICABLE;
  return passIf(
    handlesHost(game, "reset"),
    "The game does not handle the host reset command.",
  );
}

/**
 * True when the game's message handler reacts to the host `reset` command.
 * @param game parsed game
 */
export function handlesReset(game: ParsedGame): boolean {
  return handlesHost(game, "reset");
}

/** Rules cited by the `bridge` card. */
export const BRIDGE_RULES: readonly E1Rule[] = [
  {
    id: "E1-10",
    severity: "hard",
    card: "bridge",
    fix: 'Paste the CARTRIDGE helper from the bridge card verbatim (source: "cartridge", v: 1).',
    check: checkHelper,
  },
  {
    id: "E1-11",
    severity: "hard",
    card: "bridge",
    fix: 'Emit CARTRIDGE.send("boot", { title, gameType, lang }) after the first frame.',
    check: checkBoot,
  },
  {
    id: "E1-12",
    severity: "soft",
    card: "bridge",
    fix: "Make boot.lang equal the lang attribute on <html>.",
    check: checkBootLang,
  },
  {
    id: "E1-13",
    severity: "hard",
    card: "bridge",
    fix: 'Emit CARTRIDGE.send("start") when play begins.',
    check: (game) =>
      passIf(sitesFor(game, "start").length > 0, "start is never emitted."),
  },
  {
    id: "E1-14",
    severity: "hard",
    card: "bridge",
    fix: "Write boot.gameType as a string literal naming the planned game type.",
    check: checkBootType,
  },
  {
    id: "E1-18",
    severity: "soft",
    card: "bridge",
    fix: 'Send the score as a number: CARTRIDGE.send("score", { value: points }).',
    check: checkScoreValue,
  },
  {
    id: "E1-19",
    severity: "soft",
    card: "bridge",
    fix: 'Give every level call an index: CARTRIDGE.send("level", { index: stage }).',
    check: checkLevelIndex,
  },
  {
    id: "E1-20",
    severity: "soft",
    card: "bridge",
    fix: 'Listen for "message" events from source "cartridge-host" and handle pause and resume.',
    check: checkPauseResume,
  },
  {
    id: "E1-21",
    severity: "soft",
    card: "bridge",
    fix: "Handle the host reset command by returning to the pre-start screen without reloading.",
    check: checkReset,
  },
];
