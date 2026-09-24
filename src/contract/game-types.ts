import { z } from "zod";

/** The four game types a cartridge can declare (§2.2). */
export const GAME_TYPES = [
  "arcade-run",
  "stage-clear",
  "puzzle-board",
  "toy-box",
] as const;
export const GameType = z.enum(GAME_TYPES);
export type GameType = z.infer<typeof GameType>;

/** Ways a play-through can end (§2.1). */
export const END_REASONS = ["lose", "win", "stuck"] as const;
export const EndReason = z.enum(END_REASONS);
export type EndReason = z.infer<typeof EndReason>;

/** Every game-to-host event name (§2.1). */
export const BRIDGE_EVENTS = [
  "boot",
  "start",
  "score",
  "level",
  "end",
] as const;
export type BridgeEvent = (typeof BRIDGE_EVENTS)[number];

/** Events whose presence depends on the declared game type. */
export const TYPED_EVENTS = ["score", "level", "end"] as const;
export type TypedEvent = (typeof TYPED_EVENTS)[number];

export type EventRule = "required" | "optional" | "forbidden";

/** How the E2 idle window treats an `end` event (§2.2, §8). */
export type IdleDeathGate = "min-seconds" | "any-end";

/** One row of the §2.2 table. */
export interface TypeRules {
  readonly idea: string;
  readonly score: EventRule;
  readonly level: EventRule;
  readonly end: EventRule;
  readonly endReasons: readonly EndReason[];
  readonly reset: "soft" | "hard";
  readonly idleDeathGate: IdleDeathGate;
  readonly idleMotionRequired: boolean;
}

/** The single source of truth for per-type rules; E1, E2 and the cards read it. */
export const GAME_TYPE_RULES: Readonly<Record<GameType, TypeRules>> = {
  "arcade-run": {
    idea: "continuous run, one life, survive and collect",
    score: "required",
    level: "forbidden",
    end: "required",
    endReasons: ["lose"],
    reset: "soft",
    idleDeathGate: "min-seconds",
    idleMotionRequired: true,
  },
  "stage-clear": {
    idea: "discrete stages, each with a goal",
    score: "optional",
    level: "required",
    end: "required",
    endReasons: ["win", "lose"],
    reset: "soft",
    idleDeathGate: "min-seconds",
    idleMotionRequired: true,
  },
  "puzzle-board": {
    idea: "turn-based board, no clock pressure",
    score: "required",
    level: "optional",
    end: "required",
    endReasons: ["win", "stuck"],
    reset: "soft",
    idleDeathGate: "any-end",
    idleMotionRequired: false,
  },
  "toy-box": {
    idea: "open play with a visible tally and a clear-the-table replay, no losing",
    score: "optional",
    level: "forbidden",
    end: "forbidden",
    endReasons: [],
    reset: "hard",
    idleDeathGate: "any-end",
    idleMotionRequired: false,
  },
};

/**
 * Lists the typed events a game of this type must emit.
 * @param gameType the declared game type
 */
export function requiredEvents(gameType: GameType): TypedEvent[] {
  return TYPED_EVENTS.filter(
    (event) => GAME_TYPE_RULES[gameType][event] === "required",
  );
}

/**
 * Lists the typed events a game of this type must never emit.
 * @param gameType the declared game type
 */
export function forbiddenEvents(gameType: GameType): TypedEvent[] {
  return TYPED_EVENTS.filter(
    (event) => GAME_TYPE_RULES[gameType][event] === "forbidden",
  );
}

/**
 * Narrows an arbitrary string to a known game type.
 * @param value candidate value
 */
export function isGameType(value: unknown): value is GameType {
  return GameType.safeParse(value).success;
}
