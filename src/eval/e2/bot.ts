import { createHash } from "node:crypto";
import {
  BOT_TAP_GAP_MAX_MS,
  BOT_TAP_GAP_MIN_MS,
  PROBE_VIEWPORT,
} from "./thresholds.ts";

const UINT32 = 2 ** 32;
const MULBERRY_INCREMENT = 0x6d2b79f5;
const SHIFT_A = 15;
const SHIFT_B = 7;
const SHIFT_C = 14;
const ONE_BIT = 1;
const MIX_ODD = 61;
const SEED_HEX_CHARS = 8;
const HEX_RADIX = 16;

/**
 * mulberry32: a small seeded PRNG returning floats in [0, 1).
 * @param seed 32-bit integer seed
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let mixed = Math.imul(state ^ (state >>> SHIFT_A), state | ONE_BIT);
    mixed ^=
      mixed + Math.imul(mixed ^ (mixed >>> SHIFT_B), mixed | MIX_ODD);
    return ((mixed ^ (mixed >>> SHIFT_C)) >>> 0) / UINT32;
  };
}

/**
 * Seed for an item: the first 32 bits of sha256(id).
 * @param id dataset item or fixture id
 */
export function seedFromId(id: string): number {
  const digest = createHash("sha256").update(id).digest("hex");
  return Number.parseInt(digest.slice(0, SEED_HEX_CHARS), HEX_RADIX);
}

/** One planned bot tap: wait `gapMs`, then tap at (x, y) in viewport pixels. */
export interface PlannedTap {
  readonly gapMs: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Draws a deterministic sequence of taps.
 * @param random PRNG from `mulberry32`
 * @param count number of taps
 */
export function tapPlan(random: () => number, count: number): PlannedTap[] {
  const span = BOT_TAP_GAP_MAX_MS - BOT_TAP_GAP_MIN_MS;
  return Array.from({ length: count }, () => ({
    gapMs: Math.round(BOT_TAP_GAP_MIN_MS + random() * span),
    x: Math.floor(random() * PROBE_VIEWPORT.width),
    y: Math.floor(random() * PROBE_VIEWPORT.height),
  }));
}
