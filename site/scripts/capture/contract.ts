import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** One file the README and docs reference, with the pixel size it must have. */
export interface MediaSpec {
  readonly file: string;
  readonly width: number;
  readonly height: number | null;
}

const DESKTOP_WIDTH = 1440;
const DESKTOP_HEIGHT = 900;
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;
const GIF_OUTPUT_WIDTH = 960;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** Largest GIF the README may embed. */
export const MAX_GIF_BYTES = 6 * BYTES_PER_MEGABYTE;

const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
const GIF_WIDTH_OFFSET = 6;
const GIF_HEIGHT_OFFSET = 8;

/** The media contract: exactly these files, at these sizes. */
export const MEDIA_CONTRACT: readonly MediaSpec[] = [
  { file: "hero.png", width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT },
  { file: "mobile-hero.png", width: MOBILE_WIDTH, height: MOBILE_HEIGHT },
  { file: "replay-run.gif", width: GIF_OUTPUT_WIDTH, height: null },
  { file: "evaluation.png", width: DESKTOP_WIDTH, height: null },
];

/** Pixel size read from a PNG IHDR chunk or a GIF logical screen descriptor. */
function imageSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  if (path.endsWith(".png")) {
    return {
      width: bytes.readUInt32BE(PNG_WIDTH_OFFSET),
      height: bytes.readUInt32BE(PNG_HEIGHT_OFFSET),
    };
  }
  return {
    width: bytes.readUInt16LE(GIF_WIDTH_OFFSET),
    height: bytes.readUInt16LE(GIF_HEIGHT_OFFSET),
  };
}

/** Problems with one contracted file: missing, too large, or the wrong size. */
function checkSpec(dir: string, spec: MediaSpec): string[] {
  const path = join(dir, spec.file);
  if (!existsSync(path)) return [`${spec.file}: missing`];
  const problems: string[] = [];
  const bytes = statSync(path).size;
  if (spec.file.endsWith(".gif") && bytes > MAX_GIF_BYTES) {
    problems.push(
      `${spec.file}: ${String(bytes)} bytes exceeds ${String(MAX_GIF_BYTES)}`,
    );
  }
  const size = imageSize(path);
  if (
    size.width !== spec.width ||
    (spec.height !== null && size.height !== spec.height)
  ) {
    problems.push(
      `${spec.file}: ${String(size.width)}x${String(size.height)} does not match the contract`,
    );
  }
  return problems;
}

/** Every contract violation in the media directory, including files the contract does not list. */
export function verifyMedia(dir: string): string[] {
  const expected = new Set(MEDIA_CONTRACT.map((spec) => spec.file));
  const extras = existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => !expected.has(file))
        .map((file) => `${file}: not in the media contract`)
    : [];
  return [...MEDIA_CONTRACT.flatMap((spec) => checkSpec(dir, spec)), ...extras];
}

/** One line per contracted file with its size on disk. */
export function describeMedia(dir: string): string[] {
  return MEDIA_CONTRACT.map((spec) => {
    const path = join(dir, spec.file);
    if (!existsSync(path)) return `${spec.file}  missing`;
    const size = imageSize(path);
    return `${spec.file}  ${String(size.width)}x${String(size.height)}  ${String(statSync(path).size)} bytes`;
  });
}
