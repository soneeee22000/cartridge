import { canonicalJson } from "../../models/request-key.ts";
import { ReportJson } from "./types.ts";

/** Decimals every number in `report.json` is rounded to (§11.3). */
export const REPORT_DECIMALS = 3;
const JSON_INDENT = 2;

function roundNumbers(value: unknown): unknown {
  if (typeof value === "number") return Number(value.toFixed(REPORT_DECIMALS));
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, roundNumbers(inner)]),
  );
}

/**
 * Serialises a report deterministically (§11.3): validated against `cartridge-report/1`, numbers
 * rounded to fixed decimals, keys sorted recursively, two-space indent, trailing newline, and no
 * timestamp anywhere in the body.
 * @param report an aggregated report
 */
export function serialiseReport(report: ReportJson): string {
  const valid = ReportJson.parse(report);
  const sorted: unknown = JSON.parse(canonicalJson(roundNumbers(valid)));
  return `${JSON.stringify(sorted, null, JSON_INDENT)}\n`;
}
