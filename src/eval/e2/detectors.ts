import { GameEvent } from "../../contract/bridge.ts";
import { GAME_TYPE_RULES, type GameType } from "../../contract/game-types.ts";
import {
  BLANK_DISTINCT_COLOURS_MIN,
  BLANK_LUMA_STDDEV_MIN,
  BOOT_TIMEOUT_MS,
  IDLE_DEATH_MIN_SECONDS,
  IDLE_MOTION_RATIO_MIN,
  TAP_MOTION_RATIO_MIN,
} from "./thresholds.ts";
import {
  DETECTOR_IDS,
  type DetectorId,
  type DetectorVerdict,
  type E2Result,
  type Observation,
  type TimedMessage,
} from "./types.ts";

const MS_PER_SECOND = 1000;

/** One registered detector (§9.2). `run` is pure over the observation. */
export interface DetectorEntry {
  readonly id: DetectorId;
  readonly enabled: boolean;
  readonly run: (observation: Observation) => DetectorVerdict;
}

function messageType(message: TimedMessage): unknown {
  const data = message.data;
  if (typeof data !== "object" || data === null) return undefined;
  return (data as { type?: unknown }).type;
}

function messagesOfType(
  observation: Observation,
  type: string,
): TimedMessage[] {
  return observation.messages.filter(
    (message) => messageType(message) === type,
  );
}

function verdictOf(passed: boolean): DetectorVerdict {
  return passed ? "pass" : "fail";
}

function bootHandshake(observation: Observation): DetectorVerdict {
  const boot = messagesOfType(observation, "boot")[0];
  if (!boot) return "fail";
  if (boot.t - observation.loadedAtMs > BOOT_TIMEOUT_MS) return "fail";
  const parsed = GameEvent.safeParse(boot.data);
  if (!parsed.success || parsed.data.type !== "boot") return "fail";
  const { gameType, lang } = parsed.data.payload;
  return verdictOf(
    gameType === observation.staticType && lang === observation.staticLang,
  );
}

function blankFrame(observation: Observation): DetectorVerdict {
  const frame = observation.frameA;
  if (!frame) return "fail";
  return verdictOf(
    frame.lumaStddev >= BLANK_LUMA_STDDEV_MIN &&
      frame.distinctColours >= BLANK_DISTINCT_COLOURS_MIN,
  );
}

function idleStatic(observation: Observation): DetectorVerdict {
  const type = observation.staticType;
  if (!type || !GAME_TYPE_RULES[type].idleMotionRequired) return "n/a";
  return verdictOf((observation.idleMotion ?? 0) >= IDLE_MOTION_RATIO_MIN);
}

function tapUnresponsive(observation: Observation): DetectorVerdict {
  return verdictOf((observation.tapMotion ?? 0) >= TAP_MOTION_RATIO_MIN);
}

function endsInIdleWindow(observation: Observation): number[] {
  const { idleStartMs, idleEndMs } = observation;
  if (idleStartMs === null || idleEndMs === null) return [];
  return messagesOfType(observation, "end")
    .filter((message) => message.t >= idleStartMs && message.t <= idleEndMs)
    .map((message) => (message.t - idleStartMs) / MS_PER_SECOND);
}

function idleDeathFor(
  type: GameType,
  endSeconds: readonly number[],
): DetectorVerdict {
  if (GAME_TYPE_RULES[type].idleDeathGate === "any-end")
    return verdictOf(endSeconds.length === 0);
  return verdictOf(
    endSeconds.every((seconds) => seconds >= IDLE_DEATH_MIN_SECONDS),
  );
}

function idleDeath(observation: Observation): DetectorVerdict {
  const type = observation.staticType;
  if (!type) return "n/a";
  return idleDeathFor(type, endsInIdleWindow(observation));
}

function consoleError(observation: Observation): DetectorVerdict {
  return verdictOf(observation.consoleErrors.length === 0);
}

const RUNS: Readonly<Record<DetectorId, DetectorEntry["run"]>> = {
  "boot-handshake": bootHandshake,
  "blank-frame": blankFrame,
  "idle-static": idleStatic,
  "tap-unresponsive": tapUnresponsive,
  "idle-death": idleDeath,
  "console-error": consoleError,
};

/**
 * Builds the detector registry, optionally with some detectors disabled. `--disable` exists only
 * to prove that the matrix check fails when a detector is switched off (§9.2).
 * @param disabled ids to switch off
 */
export function createRegistry(
  disabled: readonly DetectorId[] = [],
): DetectorEntry[] {
  for (const id of disabled)
    if (!DETECTOR_IDS.includes(id))
      throw new Error(`unknown detector: ${id}`);
  return DETECTOR_IDS.map((id) => ({
    id,
    enabled: !disabled.includes(id),
    run: RUNS[id],
  }));
}

/** The default registry: every detector enabled. */
export const DETECTORS: readonly DetectorEntry[] = createRegistry();

/**
 * Runs every registered detector; a disabled one reports `n/a`.
 * @param observation what the probe measured
 * @param registry detector registry
 */
export function evaluateDetectors(
  observation: Observation,
  registry: readonly DetectorEntry[],
): Record<DetectorId, DetectorVerdict> {
  const entries = DETECTOR_IDS.map((id) => {
    const entry = registry.find((candidate) => candidate.id === id);
    const verdict = entry?.enabled ? entry.run(observation) : "n/a";
    return [id, verdict] as const;
  });
  return Object.fromEntries(entries) as Record<DetectorId, DetectorVerdict>;
}

function firstMessageMs(observation: Observation, type: string): number | null {
  const first = messagesOfType(observation, type)[0];
  return first ? first.t - observation.loadedAtMs : null;
}

function firstEndSeconds(observation: Observation): number | null {
  return endsInIdleWindow(observation)[0] ?? null;
}

/**
 * Folds an observation into the `e2.json` shape (§8.3). `longestPlaySeconds` is copied, not judged.
 * @param observation what the probe measured
 * @param registry detector registry
 */
export function toE2Result(
  observation: Observation,
  registry: readonly DetectorEntry[],
): E2Result {
  return {
    detectors: evaluateDetectors(observation, registry),
    metrics: {
      bootMs: firstMessageMs(observation, "boot"),
      lumaStddev: observation.frameA?.lumaStddev ?? null,
      distinctColours: observation.frameA?.distinctColours ?? null,
      idleMotionRatio: observation.idleMotion,
      tapMotionRatio: observation.tapMotion,
      firstEndSeconds: firstEndSeconds(observation),
    },
    longestPlaySeconds: observation.longestPlaySeconds,
    consoleErrors: [...observation.consoleErrors],
  };
}
