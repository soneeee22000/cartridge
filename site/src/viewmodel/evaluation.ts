import type { Matrix, MatrixEntry, Report } from "../types/report";
import { BAND_ORDER, DETECTOR_ORDER } from "./results";

/** Which fixture set a matrix row belongs to. */
export type FixtureSet = "tuning" | "holdout";

/** One fixture row of the detection matrix. */
export interface MatrixRow {
  readonly set: FixtureSet;
  readonly fixture: string;
  readonly expected: string | null;
  readonly fired: readonly string[];
  readonly verdict: string;
  readonly e1Score: number;
}

/** Caught-versus-clean counts for one fixture set. */
export interface MatrixSummary {
  readonly set: FixtureSet;
  readonly knownBad: number;
  readonly caught: number;
  readonly controls: number;
  readonly clean: number;
}

/** Rows of one fixture set, known-bad fixtures first then controls, each sorted by name. */
function setRows(
  set: FixtureSet,
  entries: Readonly<Record<string, MatrixEntry>>,
): MatrixRow[] {
  return Object.entries(entries)
    .map(([fixture, entry]) => ({ set, fixture, ...entry }))
    .sort(
      (a, b) =>
        Number(a.expected === null) - Number(b.expected === null) ||
        a.fixture.localeCompare(b.fixture),
    );
}

/** Every matrix row: tuning fixtures, then holdout fixtures. */
export function matrixRows(matrix: Matrix): MatrixRow[] {
  return [
    ...setRows("tuning", matrix.tuning),
    ...setRows("holdout", matrix.holdout),
  ];
}

/** Caught and clean counts per fixture set. */
export function matrixSummary(matrix: Matrix): MatrixSummary[] {
  return (["tuning", "holdout"] as const).map((set) => {
    const rows = setRows(set, matrix[set]);
    const bad = rows.filter((row) => row.expected !== null);
    const controls = rows.filter((row) => row.expected === null);
    return {
      set,
      knownBad: bad.length,
      caught: bad.filter((row) => row.verdict === "caught").length,
      controls: controls.length,
      clean: controls.filter((row) => row.verdict === "clean").length,
    };
  });
}

/** One length band's row: counts only, never averaged with another band. */
export interface BandTableRow {
  readonly band: string;
  readonly n: number;
  readonly games: number;
  readonly e1Min: number | null;
  readonly e2Passed: number;
  readonly e2Probed: number;
  readonly medianBuildAttempts: number | null;
  readonly e4Match: number;
  readonly e4Mismatch: number;
  readonly e4Abstain: number;
}

/** The per-band table in dataset band order. It has no "all bands" row by design. */
export function bandTable(report: Report): BandTableRow[] {
  return BAND_ORDER.map((name) => {
    const band = report.bands.find((row) => row.band === name);
    if (band === undefined)
      throw new Error(`Band ${name} missing from the report`);
    return {
      band: name,
      n: band.n,
      games: band.games,
      e1Min: band.e1.min,
      e2Passed: band.e2.passed,
      e2Probed: band.e2.probed,
      medianBuildAttempts: band.medianBuildAttempts,
      e4Match: band.e4.match ?? 0,
      e4Mismatch: band.e4.mismatch ?? 0,
      e4Abstain: band.e4.abstain ?? 0,
    };
  });
}

/** E2 failures of one detector, per band and in total. */
export interface DetectorFailRow {
  readonly detector: string;
  readonly perBand: readonly number[];
  readonly total: number;
}

/** Failure counts per detector, in SPEC order, with one column per band. */
export function detectorFailTable(report: Report): DetectorFailRow[] {
  return DETECTOR_ORDER.map((detector) => {
    const perBand = BAND_ORDER.map(
      (name) =>
        report.bands.find((row) => row.band === name)?.e2.detectorFails[
          detector
        ] ?? 0,
    );
    return {
      detector,
      perBand,
      total: perBand.reduce((sum, count) => sum + count, 0),
    };
  });
}

/** E4 language verdict counts over all 20 items (counts, not a rate). */
export interface LanguageCounts {
  readonly match: number;
  readonly mismatch: number;
  readonly abstain: number;
}

/** E4 verdicts counted over the items. */
export function languageCounts(report: Report): LanguageCounts {
  const count = (verdict: string): number =>
    report.items.filter((item) => item.e4?.verdict === verdict).length;
  return {
    match: count("match"),
    mismatch: count("mismatch"),
    abstain: count("abstain"),
  };
}

/** One bar of the build-attempt histogram. */
export interface HistogramBar {
  readonly attempts: number;
  readonly items: number;
}

/** Build attempts per item, from the report's repair histogram, ascending. */
export function repairHistogram(report: Report): HistogramBar[] {
  return Object.entries(report.repair.histogram)
    .map(([attempts, items]) => ({ attempts: Number(attempts), items }))
    .sort((a, b) => a.attempts - b.attempts);
}

/** Which E1 rules triggered a repair, most frequent first. */
export function repairTriggers(
  report: Report,
): { rule: string; count: number }[] {
  return Object.entries(report.repair.triggers)
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
}

/** Width of a bar as a share of the largest bar, in [0, 1]. */
export function barShare(value: number, largest: number): number {
  if (largest <= 0) return 0;
  return Math.min(Math.max(value / largest, 0), 1);
}
