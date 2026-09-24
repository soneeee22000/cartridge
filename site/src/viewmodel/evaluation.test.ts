import { describe, expect, it } from "vitest";
import { fullReport, matrix } from "../data/report";
import {
  bandTable,
  barShare,
  detectorFailTable,
  languageCounts,
  matrixRows,
  matrixSummary,
  repairHistogram,
  repairTriggers,
} from "./evaluation";

describe("detection matrix", () => {
  it("summarises tuning and holdout caught versus clean", () => {
    expect(matrixSummary(matrix)).toEqual([
      { set: "tuning", knownBad: 6, caught: 6, controls: 4, clean: 4 },
      { set: "holdout", knownBad: 6, caught: 6, controls: 0, clean: 0 },
    ]);
  });

  it("lists known-bad fixtures before controls, every fixture with E1 1.000", () => {
    const rows = matrixRows(matrix);
    expect(rows).toHaveLength(16);
    expect(rows[0]?.fixture).toBe("kb-01-dead-boot");
    expect(rows.slice(6, 10).every((row) => row.expected === null)).toBe(true);
    expect(rows.every((row) => row.e1Score === 1)).toBe(true);
  });
});

describe("per-band table", () => {
  const rows = bandTable(fullReport);

  it("has exactly the four bands and no cross-band row", () => {
    expect(rows.map((row) => row.band)).toEqual([
      "terse",
      "short-brief",
      "full-brief",
      "edge",
    ]);
  });

  it("keeps each band's own counts", () => {
    expect(rows.map((row) => [row.e2Passed, row.e2Probed])).toEqual([
      [3, 5],
      [2, 5],
      [4, 5],
      [2, 5],
    ]);
    expect(rows.every((row) => row.e1Min === 1)).toBe(true);
  });
});

describe("E2 detector failures", () => {
  it("counts failures per detector and band", () => {
    const table = detectorFailTable(fullReport);
    const byId = Object.fromEntries(table.map((row) => [row.detector, row]));
    expect(byId["idle-death"]?.total).toBe(4);
    expect(byId["console-error"]?.perBand).toEqual([0, 1, 1, 1]);
    expect(byId["boot-handshake"]?.total).toBe(0);
  });
});

describe("E4 language", () => {
  it("counts 18 matches and 2 abstentions, agreeing with the band rows", () => {
    const counts = languageCounts(fullReport);
    expect(counts).toEqual({ match: 18, mismatch: 0, abstain: 2 });
    const bands = bandTable(fullReport);
    expect(bands.reduce((sum, row) => sum + row.e4Match, 0)).toBe(counts.match);
  });
});

describe("repairs", () => {
  it("reads the build-attempt histogram and the triggers", () => {
    expect(repairHistogram(fullReport)).toEqual([
      { attempts: 1, items: 15 },
      { attempts: 2, items: 5 },
    ]);
    expect(repairTriggers(fullReport)).toEqual([
      { rule: "E1-24", count: 4 },
      { rule: "E1-15", count: 1 },
    ]);
  });

  it("clamps bar shares", () => {
    expect(barShare(5, 15)).toBeCloseTo(1 / 3);
    expect(barShare(1, 0)).toBe(0);
    expect(barShare(20, 15)).toBe(1);
  });
});
