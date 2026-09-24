import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Output frame rate for every GIF. */
export const GIF_FPS = 15;
/** Output width for every GIF, in pixels. */
export const GIF_WIDTH = 960;

const MS_PER_SECOND = 1000;
const FRAME_DIGITS = 5;
const FRAME_PATTERN = `frame-%0${String(FRAME_DIGITS)}d.png`;
const BAYER_SCALE = 5;

/** A numbered PNG frame sequence on disk. */
export interface FrameSequence {
  readonly dir: string;
  count: number;
}

/** Create an empty frame directory under the scratch root. */
export function createSequence(root: string, name: string): FrameSequence {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return { dir, count: 0 };
}

/** Path of the frame at a given index. */
function framePath(sequence: FrameSequence, index: number): string {
  return join(
    sequence.dir,
    `frame-${String(index).padStart(FRAME_DIGITS, "0")}.png`,
  );
}

/** Number of frames that cover a duration at the GIF frame rate. */
export function framesFor(durationMs: number): number {
  return Math.max(Math.round((durationMs * GIF_FPS) / MS_PER_SECOND), 0);
}

/** Duration of one frame in ms. */
export function frameDurationMs(): number {
  return MS_PER_SECOND / GIF_FPS;
}

/** Append one frame written by the given screenshot callback. */
export async function addFrame(
  sequence: FrameSequence,
  shoot: (path: string) => Promise<unknown>,
): Promise<void> {
  await shoot(framePath(sequence, sequence.count));
  sequence.count += 1;
}

/** Repeat the last frame so a state holds on screen without re-rendering it. */
export function holdFrames(sequence: FrameSequence, count: number): void {
  if (sequence.count === 0)
    throw new Error("Cannot hold an empty frame sequence");
  const last = framePath(sequence, sequence.count - 1);
  for (let repeat = 0; repeat < count; repeat += 1) {
    copyFileSync(last, framePath(sequence, sequence.count));
    sequence.count += 1;
  }
}

/** Run ffmpeg quietly and fail on a non-zero exit. */
function ffmpeg(args: readonly string[]): void {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with status ${String(result.status)}`);
  }
}

/** Dithering for paletteuse: bayer for shaded 3D scenes, none for flat text on a solid ground. */
export type Dither = "bayer" | "none";

/** The paletteuse dither options for a dither mode. */
function ditherOptions(dither: Dither): string {
  return dither === "bayer"
    ? `dither=bayer:bayer_scale=${String(BAYER_SCALE)}`
    : "dither=none";
}

/** Two-pass palettegen and paletteuse encode of a frame sequence into a looping GIF. */
export function encodeGif(
  sequence: FrameSequence,
  output: string,
  dither: Dither,
): void {
  const input = [
    "-framerate",
    String(GIF_FPS),
    "-i",
    join(sequence.dir, FRAME_PATTERN),
  ];
  const scale = `scale=${String(GIF_WIDTH)}:-1:flags=lanczos`;
  const palette = join(sequence.dir, "palette.png");
  ffmpeg([...input, "-vf", `${scale},palettegen=stats_mode=diff`, palette]);
  const use = `[0:v]${scale}[scaled];[scaled][1:v]paletteuse=${ditherOptions(dither)}:diff_mode=rectangle`;
  ffmpeg([...input, "-i", palette, "-lavfi", use, "-loop", "0", output]);
}
