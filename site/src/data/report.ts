import type { Matrix, Report, ReportItem } from "../types/report";
import fullJson from "./full.json";
import matrixJson from "./matrix.json";
import sampleJson from "./sample.json";

/** `reports/committed/full.json`: the full tier, 20 items, one generation each. */
export const fullReport: Report = fullJson;

/** `reports/committed/sample.json`: the four-item sample tier the cost estimate was derived from. */
export const sampleReport: Report = sampleJson;

/** `reports/committed/matrix.json`: detection-matrix verdicts on the hand-authored fixtures. */
export const matrix: Matrix = matrixJson;

/** One item of the full report by id, or a loud failure. */
export function reportItem(id: string): ReportItem {
  const item = fullReport.items.find((entry) => entry.id === id);
  if (item === undefined) throw new Error(`Item ${id} missing from full.json`);
  return item;
}
