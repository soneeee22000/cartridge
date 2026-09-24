import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatMinutes,
  formatScore,
  formatSeconds,
  formatTokens,
  formatUsd,
} from "./format";

describe("format helpers", () => {
  it("formats scores with three decimals and rejects values outside [0, 1]", () => {
    expect(formatScore(1)).toBe("1.000");
    expect(formatScore(0.952)).toBe("0.952");
    expect(() => formatScore(1.2)).toThrow(RangeError);
  });

  it("formats counts, dollars, seconds, minutes and tokens", () => {
    expect(formatCount(11, 20)).toBe("11/20");
    expect(formatUsd(3.15)).toBe("$3.15");
    expect(formatSeconds(62075)).toBe("62.1 s");
    expect(formatMinutes(1341408)).toBe("22 min 21 s");
    expect(formatTokens(614025)).toBe("614,025");
  });
});
