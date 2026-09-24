import { PNG } from "pngjs";
import { MOTION_CHANNEL_DELTA_MIN } from "./thresholds.ts";

/** Raw RGBA pixels, row-major, four bytes per pixel. */
export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

const CHANNELS = 4;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
/** ITU-R BT.601 luma weights, scaled to integers so a flat frame has exactly zero spread. */
const LUMA_RED = 299;
const LUMA_GREEN = 587;
const LUMA_BLUE = 114;
const LUMA_SCALE = 1000;
const BYTE_SHIFT = 8;

function channel(frame: Frame, offset: number): number {
  return frame.data[offset] ?? 0;
}

function pixelCount(frame: Frame): number {
  return frame.width * frame.height;
}

/**
 * Decodes a PNG (for example an `iframe.screenshot()` buffer) into RGBA pixels.
 * @param buffer PNG bytes
 */
export function decodePng(buffer: Buffer): Frame {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

/**
 * Standard deviation of per-pixel luma (0–255 scale).
 * @param frame decoded frame
 */
export function lumaStddev(frame: Frame): number {
  const count = pixelCount(frame);
  if (count === 0) return 0;
  const lumas = new Float64Array(count);
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * CHANNELS;
    lumas[index] =
      LUMA_RED * channel(frame, offset + RED_OFFSET) +
      LUMA_GREEN * channel(frame, offset + GREEN_OFFSET) +
      LUMA_BLUE * channel(frame, offset + BLUE_OFFSET);
    sum += lumas[index] ?? 0;
  }
  const mean = sum / count;
  let squares = 0;
  for (const luma of lumas) squares += (luma - mean) ** 2;
  return Math.sqrt(squares / count) / LUMA_SCALE;
}

/**
 * Number of distinct RGBA values in the frame.
 * @param frame decoded frame
 */
export function distinctColours(frame: Frame): number {
  const seen = new Set<number>();
  for (
    let offset = 0;
    offset < pixelCount(frame) * CHANNELS;
    offset += CHANNELS
  ) {
    let packed = 0;
    for (const part of [RED_OFFSET, GREEN_OFFSET, BLUE_OFFSET, ALPHA_OFFSET])
      packed = packed * (1 << BYTE_SHIFT) + channel(frame, offset + part);
    seen.add(packed);
  }
  return seen.size;
}

/**
 * Share of pixels whose summed |ΔR|+|ΔG|+|ΔB| exceeds `MOTION_CHANNEL_DELTA_MIN`.
 * @param before earlier frame
 * @param after later frame of the same size
 */
export function motionRatio(before: Frame, after: Frame): number {
  if (before.width !== after.width || before.height !== after.height)
    throw new Error("motionRatio needs two frames of the same size");
  const count = pixelCount(before);
  if (count === 0) return 0;
  let moved = 0;
  for (let offset = 0; offset < count * CHANNELS; offset += CHANNELS) {
    let delta = 0;
    for (const part of [RED_OFFSET, GREEN_OFFSET, BLUE_OFFSET])
      delta += Math.abs(
        channel(before, offset + part) - channel(after, offset + part),
      );
    if (delta > MOTION_CHANNEL_DELTA_MIN) moved += 1;
  }
  return moved / count;
}
