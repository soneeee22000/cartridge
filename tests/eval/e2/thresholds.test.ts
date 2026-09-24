import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as thresholds from "../../../src/eval/e2/thresholds.ts";
import { REPO_ROOT } from "../../../src/eval/matrix.ts";

const NOTE = join(REPO_ROOT, "docs", "research", "e2-calibration.md");
const FROZEN_ROW = /^\|\s*`([A-Z_]+)`\s*\|\s*([^|]+?)\s*\|/;
const FROZEN_SECTION = "## Frozen values";

function frozenTable(): Map<string, string> {
  const text = readFileSync(NOTE, "utf8");
  const section = text.slice(text.indexOf(FROZEN_SECTION));
  const rows = new Map<string, string>();
  for (const line of section.split("\n").slice(1)) {
    if (line.startsWith("## ")) break;
    const match = FROZEN_ROW.exec(line);
    if (match?.[1] && match[2]) rows.set(match[1], match[2]);
  }
  return rows;
}

function printed(value: unknown): string {
  if (typeof value === "number") return String(value);
  const viewport = value as { width: number; height: number };
  return `${String(viewport.width)} × ${String(viewport.height)}`;
}

describe("frozen E2 thresholds (§8.3, §9.3)", () => {
  const table = frozenTable();

  it("the calibration note lists every exported constant", () => {
    expect([...table.keys()].sort()).toEqual(Object.keys(thresholds).sort());
  });

  it.each(Object.entries(thresholds))(
    "%s equals the calibration note",
    (name, value) => {
      expect(table.get(name)?.replace(/_/g, "")).toBe(printed(value));
    },
  );

  it("the calibration note lists only tuning fixtures", () => {
    const text = readFileSync(NOTE, "utf8");
    expect(text).not.toMatch(/\bho-\d{2}/);
  });
});
