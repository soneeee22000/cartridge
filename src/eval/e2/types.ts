import { z } from "zod";
import type { GameType } from "../../contract/game-types.ts";

/** Every E2 detector, in registry order (§8.2). */
export const DETECTOR_IDS = [
  "boot-handshake",
  "blank-frame",
  "idle-static",
  "tap-unresponsive",
  "idle-death",
  "console-error",
] as const;
export const DetectorIdSchema = z.enum(DETECTOR_IDS);
export type DetectorId = z.infer<typeof DetectorIdSchema>;

export const DetectorVerdict = z.enum(["pass", "fail", "n/a"]);
export type DetectorVerdict = z.infer<typeof DetectorVerdict>;

/** A bridge message as the host recorded it, with the host's `performance.now()`. */
export interface TimedMessage {
  readonly t: number;
  readonly data: unknown;
}

export interface FrameStats {
  readonly lumaStddev: number;
  readonly distinctColours: number;
}

/**
 * Everything the probe measured in the browser. Detectors are pure functions of this value.
 * Times are host `performance.now()` milliseconds.
 */
export interface Observation {
  readonly staticType: GameType | null;
  readonly staticLang: string | null;
  readonly loadedAtMs: number;
  readonly messages: readonly TimedMessage[];
  /** When the idle window began: the first `start`, or the centre tap if `start` never came. */
  readonly idleStartMs: number | null;
  readonly idleEndMs: number | null;
  readonly frameA: FrameStats | null;
  readonly idleMotion: number | null;
  readonly tapMotion: number | null;
  readonly consoleErrors: readonly string[];
  /** Random-tap bot result; reported only, never read by a detector. */
  readonly longestPlaySeconds: number | null;
}

/** `games/<runKey>/e2.json` (§8.3). */
export const E2Result = z.object({
  detectors: z.record(DetectorIdSchema, DetectorVerdict),
  metrics: z.object({
    bootMs: z.number().nullable(),
    lumaStddev: z.number().nullable(),
    distinctColours: z.number().nullable(),
    idleMotionRatio: z.number().nullable(),
    tapMotionRatio: z.number().nullable(),
    firstEndSeconds: z.number().nullable(),
  }),
  longestPlaySeconds: z.number().nullable(),
  consoleErrors: z.array(z.string()),
});
export type E2Result = z.infer<typeof E2Result>;
