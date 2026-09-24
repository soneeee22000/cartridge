import { describe, expect, it } from "vitest";
import { needsScrollHint, trackProgress } from "./scroll";

describe("scroll track progress", () => {
  it("is zero before the track reaches the top of the viewport", () => {
    expect(trackProgress(300, 2000, 900)).toBe(0);
  });

  it("grows as the track scrolls past the top", () => {
    expect(trackProgress(-550, 2000, 900)).toBe(0.5);
  });

  it("is one once the end of the track is in view", () => {
    expect(trackProgress(-1100, 2000, 900)).toBe(1);
    expect(trackProgress(-5000, 2000, 900)).toBe(1);
  });

  it("is zero when the track is no taller than the viewport", () => {
    expect(trackProgress(-100, 800, 900)).toBe(0);
  });
});

describe("scroll hint", () => {
  it("is needed only while the region overflows its box", () => {
    expect(needsScrollHint(1034, 343)).toBe(true);
    expect(needsScrollHint(704, 704)).toBe(false);
    expect(needsScrollHint(600, 704)).toBe(false);
  });
});
