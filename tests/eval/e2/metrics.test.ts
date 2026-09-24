import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  decodePng,
  distinctColours,
  lumaStddev,
  motionRatio,
  type Frame,
} from "../../../src/eval/e2/metrics.ts";

const SIZE = 20;
const CHANNELS = 4;
const OPAQUE = 255;
const BLOCK = 5;

type Rgb = readonly [number, number, number];

function frameOf(paint: (x: number, y: number) => Rgb): Frame {
  const data = new Uint8Array(SIZE * SIZE * CHANNELS);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const offset = (y * SIZE + x) * CHANNELS;
      data.set([...paint(x, y), OPAQUE], offset);
    }
  }
  return { width: SIZE, height: SIZE, data };
}

const solid = (): Frame => frameOf(() => [40, 80, 120]);
const noise = (): Frame =>
  frameOf((x, y) => {
    const value = (x * 73 + y * 151) % 256;
    return [value, (value * 7) % 256, (value * 13) % 256];
  });
const blockAt = (left: number): Frame =>
  frameOf((x, y) =>
    x >= left && x < left + BLOCK && y < BLOCK ? [250, 250, 250] : [0, 0, 0],
  );

describe("E2 metrics (§8.1)", () => {
  it("a solid frame has zero luma spread and one colour", () => {
    expect(lumaStddev(solid())).toBe(0);
    expect(distinctColours(solid())).toBe(1);
  });

  it("a noise frame has a wide luma spread and many colours", () => {
    expect(lumaStddev(noise())).toBeGreaterThan(40);
    expect(distinctColours(noise())).toBeGreaterThan(100);
  });

  it("identical frames have no motion", () => {
    expect(motionRatio(noise(), noise())).toBe(0);
  });

  it("a shifted block moves exactly the pixels it leaves and enters", () => {
    const shift = 2;
    const moved = 2 * shift * BLOCK;
    expect(motionRatio(blockAt(0), blockAt(shift))).toBeCloseTo(
      moved / (SIZE * SIZE),
    );
  });

  it("ignores channel changes at or below the delta floor", () => {
    const faint = frameOf(() => [50, 90, 130]);
    expect(motionRatio(solid(), faint)).toBe(0);
  });

  it("rejects frames of different sizes", () => {
    const small: Frame = { width: 1, height: 1, data: new Uint8Array(4) };
    expect(() => motionRatio(solid(), small)).toThrow(/size/);
  });

  it("decodes a PNG buffer into a frame", () => {
    const png = new PNG({ width: SIZE, height: SIZE });
    png.data = Buffer.from(noise().data);
    const frame = decodePng(PNG.sync.write(png));
    expect(frame.width).toBe(SIZE);
    expect(distinctColours(frame)).toBe(distinctColours(noise()));
  });
});
