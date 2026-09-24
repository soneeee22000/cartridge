import type { BandRow, Report, ReportItem } from "../types/report";

/** The E2 detectors in the order SPEC §8.2 lists them. */
export const DETECTOR_ORDER = [
  "boot-handshake",
  "blank-frame",
  "idle-static",
  "tap-unresponsive",
  "idle-death",
  "console-error",
] as const;

/** The four length bands in dataset order (SPEC §11.1). */
export const BAND_ORDER = [
  "terse",
  "short-brief",
  "full-brief",
  "edge",
] as const;

const PERFECT_SCORE = 1;
const FAIL = "fail";

/** Whether a game failed at least one applicable E2 detector. */
export function failsRuntime(item: ReportItem): boolean {
  if (item.e2 === null) return false;
  return Object.values(item.e2.detectors).some((verdict) => verdict === FAIL);
}

/** The detectors one game failed, in SPEC order. */
export function failedDetectors(item: ReportItem): string[] {
  const detectors = item.e2?.detectors ?? {};
  return DETECTOR_ORDER.filter((id) => detectors[id] === FAIL);
}

/** The headline figures, each computed from the committed full report. */
export interface HeadlineFacts {
  readonly items: number;
  readonly games: number;
  readonly e1Perfect: number;
  readonly e1Min: number;
  readonly e2Probed: number;
  readonly e2Passed: number;
  readonly staticPerfectRuntimeFail: number;
  readonly repaired: number;
  readonly estUsd: number;
  readonly usdLabel: string;
}

/** Sum a per-band count. */
function sumBands(
  bands: readonly BandRow[],
  pick: (band: BandRow) => number,
): number {
  return bands.reduce((total, band) => total + pick(band), 0);
}

/** Headline facts for the hero and the "why" section. */
export function headlineFacts(report: Report): HeadlineFacts {
  const items = report.items;
  return {
    items: report.totals.n,
    games: report.totals.games,
    e1Perfect: items.filter((item) => item.e1Score === PERFECT_SCORE).length,
    e1Min: Math.min(...items.map((item) => item.e1Score ?? 0)),
    e2Probed: sumBands(report.bands, (band) => band.e2.probed),
    e2Passed: sumBands(report.bands, (band) => band.e2.passed),
    staticPerfectRuntimeFail: items.filter(
      (item) => item.e1Score === PERFECT_SCORE && failsRuntime(item),
    ).length,
    repaired: items.filter((item) => item.buildAttempts > 1).length,
    estUsd: report.cost.estUsd,
    usdLabel: report.cost.usdLabel,
  };
}

/** One game that passed every static rule and still failed at runtime. */
export interface RuntimeFailure {
  readonly id: string;
  readonly band: string;
  readonly gameType: string;
  readonly detectors: readonly string[];
}

/** Every statically perfect game that failed an E2 detector, in report order. */
export function runtimeFailures(report: Report): RuntimeFailure[] {
  return report.items
    .filter((item) => item.e1Score === PERFECT_SCORE && failsRuntime(item))
    .map((item) => ({
      id: item.id,
      band: item.lengthBand,
      gameType: item.gameType ?? "none",
      detectors: failedDetectors(item),
    }));
}

/** A game that went through at least one repair, preferring the given rule as its trigger. */
export function repairedItem(report: Report, rule: string): ReportItem {
  const item =
    report.items.find((entry) => entry.repairRules.includes(rule)) ??
    report.items.find((entry) => entry.buildAttempts > 1);
  if (item === undefined) throw new Error("No repaired item in full.json");
  return item;
}
