import type { Usage } from "../../engine/usage.ts";
import { DIMENSIONS } from "../e3/rubric.ts";
import type { BandRow, ReportJson } from "./types.ts";

export interface MarkdownOptions {
  /** Git sha of the scorer; printed in the header only, so `report.json` stays byte-stable. */
  readonly scorerSha: string;
}

const DECIMALS = 3;
const USD_DECIMALS = 2;
const MS_PER_SECOND = 1_000;
const NONE = "-";

function fixed(value: number | null, decimals = DECIMALS): string {
  return value === null ? NONE : value.toFixed(decimals);
}

function table(
  head: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  const rule = line(head.map(() => "---"));
  return [line(head), rule, ...rows.map(line)].join("\n");
}

function tallyText(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).sort(([left], [right]) =>
    left < right ? -1 : 1,
  );
  return entries.length === 0
    ? NONE
    : entries.map(([key, n]) => `${key} ${n}`).join(", ");
}

function headerSection(report: ReportJson, options: MarkdownOptions): string {
  const { header } = report;
  return [
    "## Run header",
    "",
    table(
      ["field", "value"],
      [
        ["tier", header.tier],
        ["label", header.label],
        ["dataset version", header.datasetVersion],
        [
          "planner / builder model",
          `${header.models.planner} / ${header.models.builder}`,
        ],
        ["judge model", header.models.judge],
        ["price table version", header.priceTableVersion],
        ["scorer git sha", options.scorerSha],
      ],
    ),
  ].join("\n");
}

function outcomeRow(
  label: string,
  row: Omit<
    BandRow,
    "band" | "e1" | "e2" | "e3" | "e4" | "medianBuildAttempts"
  >,
): string[] {
  return [
    label,
    ...[
      row.n,
      row.games,
      row.contractFailed,
      row.refusals,
      row.harnessFailures,
    ].map(String),
  ];
}

function qualityRow(row: BandRow): string[] {
  const { e4 } = row;
  return [
    row.band,
    fixed(row.e1?.mean ?? null),
    fixed(row.e1?.min ?? null),
    `${row.e2.passed}/${row.e2.probed}`,
    tallyText(row.e2.detectorFails),
    `${e4.match}/${e4.mismatch}/${e4.abstain}`,
    fixed(row.medianBuildAttempts, 1),
  ];
}

function e3Rows(bands: readonly BandRow[]): string[][] {
  return bands.flatMap((row) =>
    DIMENSIONS.map((dimension) => [
      row.band,
      dimension,
      tallyText(row.e3[dimension]),
    ]),
  );
}

function bandSection(report: ReportJson): string {
  const { e4Labelled } = report;
  return [
    "## Per-band results",
    "",
    "### Outcomes",
    "",
    table(
      ["band", "n", "games", "contract-failed", "refusals", "harness failures"],
      [
        ...report.bands.map((row) => outcomeRow(row.band, row)),
        outcomeRow("all", report.totals),
      ],
    ),
    "",
    "### Quality",
    "",
    "Game items only. There is no cross-band mean. E4 is match/mismatch/abstain, and an abstention is not a pass.",
    "",
    table(
      [
        "band",
        "E1 mean",
        "E1 min",
        "E2 passed/probed",
        "E2 detector fails",
        "E4 m/mm/abs",
        "median build attempts",
      ],
      report.bands.map(qualityRow),
    ),
    "",
    "### E3 labels",
    "",
    "Label counts on game items. `null` means no cited finding survived validation; `n/a` means the dimension does not apply. Labels are never averaged.",
    "",
    table(["band", "dimension", "labels"], e3Rows(report.bands)),
    "",
    `E4 labelled set: accuracy ${fixed(e4Labelled.accuracy)}, abstention rate ${fixed(e4Labelled.abstentionRate)} (${e4Labelled.note}).`,
  ].join("\n");
}

function repairSection(report: ReportJson): string {
  const { histogram, triggers } = report.repair;
  const attempts = Object.entries(histogram).sort(
    ([left], [right]) => Number(left) - Number(right),
  );
  const rules = Object.entries(triggers).sort(([left], [right]) =>
    left < right ? -1 : 1,
  );
  return [
    "## Repair loop",
    "",
    table(
      ["build attempts", "items"],
      attempts.map(([key, n]) => [key, String(n)]),
    ),
    "",
    rules.length === 0
      ? "No repair was triggered."
      : table(
          ["rule that triggered a repair", "times"],
          rules.map(([key, n]) => [key, String(n)]),
        ),
  ].join("\n");
}

function failureSection(report: ReportJson): string {
  const rows = Object.entries(report.failures).flatMap(([step, codes]) =>
    Object.entries(codes).map(([code, n]) => [step, code, String(n)]),
  );
  const body =
    rows.length === 0 ? "No failures." : table(["step", "code", "items"], rows);
  return ["## Failures by attributed step", "", body].join("\n");
}

function usageRow(label: string, usage: Usage): string[] {
  return [
    label,
    ...[usage.input, usage.output, usage.cacheRead, usage.cacheWrite].map(
      String,
    ),
  ];
}

function costSection(report: ReportJson): string {
  const { cost } = report;
  const seconds = (ms: number | null) =>
    ms === null ? NONE : `${(ms / MS_PER_SECOND).toFixed(1)} s`;
  return [
    "## Cost and latency",
    "",
    table(
      ["tokens", "input", "output", "cache read", "cache write"],
      [
        usageRow(
          `generator (${report.header.models.builder})`,
          cost.tokens.generator,
        ),
        usageRow(`judge (${report.header.models.judge})`, cost.tokens.judge),
        usageRow("of which repair passes", cost.repairTokens),
      ],
    ),
    "",
    `Measured cache reads on repair passes: ${cost.repairCacheRead} tokens.`,
    "",
    `Estimated cost: $${cost.estUsd.toFixed(USD_DECIMALS)} (${cost.usdLabel}).`,
    "",
    `Wall time: ${seconds(cost.wallMsTotal)} in total, ${seconds(cost.wallMsMedian)} median per item (from run.json).`,
  ].join("\n");
}

/**
 * Renders `report.md` with the §11.3 sections in order.
 * @param report the aggregated report
 * @param options scorer git sha for the header
 */
export function renderMarkdown(
  report: ReportJson,
  options: MarkdownOptions,
): string {
  const { header } = report;
  return (
    [
      `# Eval report: ${header.tier} / ${header.label}`,
      headerSection(report, options),
      bandSection(report),
      repairSection(report),
      failureSection(report),
      costSection(report),
      [
        "## Out of scope for this run",
        "",
        ...report.notMeasured.map((line) => `- ${line}`),
      ].join("\n"),
      ["## Noise floor", "", report.noiseFloor].join("\n"),
    ].join("\n\n") + "\n"
  );
}
