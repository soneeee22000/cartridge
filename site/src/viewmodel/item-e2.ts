import type { ReportItem } from "../types/report";
import { DETECTOR_ORDER } from "./results";

/** A detector verdict the page can draw; anything unexpected reads as not measured. */
export type ShownVerdict = "pass" | "fail" | "n/a" | "not measured";

/** One detector row of an item's committed E2 result. */
export interface DetectorRow {
  readonly detector: string;
  readonly verdict: ShownVerdict;
}

/** A distinct console error and how many times the probe saw it. */
export interface ConsoleErrorRow {
  readonly message: string;
  readonly count: number;
}

/** An item's committed E2 result, shaped for the replay panel. */
export interface ItemE2View {
  readonly passed: boolean;
  readonly detectors: readonly DetectorRow[];
  readonly consoleErrors: readonly ConsoleErrorRow[];
  readonly longestPlaySeconds: number | null;
}

const KNOWN: readonly ShownVerdict[] = ["pass", "fail", "n/a"];

/** Narrow a stored verdict string. */
function shown(value: string | undefined): ShownVerdict {
  return KNOWN.find((verdict) => verdict === value) ?? "not measured";
}

/** Collapse repeated console errors into one row each, in first-seen order. */
export function distinctErrors(messages: readonly string[]): ConsoleErrorRow[] {
  const counts = new Map<string, number>();
  for (const message of messages)
    counts.set(message, (counts.get(message) ?? 0) + 1);
  return [...counts].map(([message, count]) => ({ message, count }));
}

/** The committed E2 result of one item, or null when it was never probed. */
export function itemE2View(item: ReportItem): ItemE2View | null {
  if (item.e2 === null) return null;
  const detectors = DETECTOR_ORDER.map((detector) => ({
    detector,
    verdict: shown(item.e2?.detectors[detector]),
  }));
  return {
    passed: detectors.every((row) => row.verdict !== "fail"),
    detectors,
    consoleErrors: distinctErrors(item.e2.consoleErrors),
    longestPlaySeconds: item.e2.longestPlaySeconds,
  };
}
