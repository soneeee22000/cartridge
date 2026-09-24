import { describe, expect, it } from "vitest";
import { buildReport } from "../../../src/eval/report/aggregate.ts";
import { serialiseReport } from "../../../src/eval/report/json.ts";
import { renderMarkdown } from "../../../src/eval/report/markdown.ts";
import { ReportJson, outcomeOf } from "../../../src/eval/report/types.ts";
import { USD_LABEL } from "../../../src/eval/pricing.ts";
import { fixtureItems } from "./fixture-run.ts";

const SECTION_ORDER = [
  "## Run header",
  "## Per-band results",
  "## Repair loop",
  "## Failures by attributed step",
  "## Cost and latency",
  "## Out of scope for this run",
  "## Noise floor",
];

function report() {
  return buildReport({
    tier: "full",
    label: "fixture",
    datasetVersion: "v1",
    items: fixtureItems(),
  });
}

describe("outcome mapping (§11.3)", () => {
  it("maps row status and failure codes onto exactly one outcome", () => {
    expect(outcomeOf("complete", null)).toBe("game");
    expect(outcomeOf("abandoned", "contract-unmet")).toBe("contract-failed");
    expect(outcomeOf("abandoned", "budget-exhausted")).toBe("contract-failed");
    expect(outcomeOf("abandoned", "generate-truncated")).toBe(
      "contract-failed",
    );
    expect(outcomeOf("abandoned", "plan-invalid-spec")).toBe("contract-failed");
    expect(outcomeOf("abandoned", "generate-no-artifact")).toBe(
      "contract-failed",
    );
    expect(outcomeOf("abandoned", "model-refusal")).toBe("refusal");
    for (const code of [
      "cassette-miss",
      "verifier-crashed",
      "engine-crashed",
      "model-error",
      "stream-cut",
      "lease-lost",
      "timeout",
    ])
      expect(outcomeOf("abandoned", code)).toBe("harness-failure");
    expect(outcomeOf("waiting", null)).toBe("harness-failure");
  });
});

describe("report aggregate (§11.3)", () => {
  it("has one row per length band, in band order", () => {
    expect(report().bands.map((row) => row.band)).toEqual([
      "terse",
      "short-brief",
      "full-brief",
      "edge",
    ]);
  });

  it("counts outcomes per band and keeps refusals and harness failures apart", () => {
    const bands = report().bands;
    expect(bands[0]).toMatchObject({ n: 2, games: 2, contractFailed: 0 });
    expect(bands[1]).toMatchObject({ n: 1, games: 0, contractFailed: 1 });
    expect(bands[2]).toMatchObject({ n: 1, refusals: 1, harnessFailures: 0 });
    expect(bands[3]).toMatchObject({ n: 2, games: 1, harnessFailures: 1 });
  });

  it("computes quality only over game items", () => {
    const terse = report().bands[0];
    expect(terse?.e1).toEqual({ mean: (1 + 0.9166666) / 2, min: 0.9166666 });
    expect(terse?.e2).toMatchObject({ probed: 2, passed: 1 });
    expect(terse?.e2.detectorFails["idle-death"]).toBe(1);
    expect(report().bands[1]?.e1).toBeNull();
  });

  it("keeps E3 null and n/a counts separate, and never averages labels", () => {
    const edge = report().bands[3];
    expect(edge?.e3["fail-state-clarity"]).toEqual({ "n/a": 1 });
    expect(edge?.e3["goal-legibility"]).toEqual({ null: 1 });
    const terse = report().bands[0];
    expect(terse?.e3["goal-legibility"]).toEqual({ implied: 2 });
  });

  it("counts E4 match, mismatch and abstain without scoring abstentions", () => {
    expect(report().bands[3]?.e4).toEqual({
      match: 0,
      mismatch: 0,
      abstain: 1,
    });
    expect(report().bands[0]?.e4).toEqual({
      match: 2,
      mismatch: 0,
      abstain: 0,
    });
  });

  it("has no cross-band quality mean: totals hold counts and cost only", () => {
    const built = report();
    expect(Object.keys(built.totals).sort()).toEqual(
      [
        "contractFailed",
        "estUsd",
        "games",
        "harnessFailures",
        "n",
        "refusals",
      ].sort(),
    );
    expect(built.bands.some((row) => (row.band as string) === "all")).toBe(
      false,
    );
  });

  it("builds the repair histogram and the triggering rules", () => {
    const { repair } = report();
    expect(repair.histogram).toEqual({ "0": 2, "1": 2, "2": 1, "4": 1 });
    expect(repair.triggers).toEqual({ "E1-11": 1, "E1-13": 3 });
  });

  it("groups failures by attributed step and code", () => {
    expect(report().failures).toEqual({
      driver: { timeout: 1 },
      generate: { "contract-unmet": 1 },
      plan: { "model-refusal": 1 },
    });
  });

  it("reports tokens by disjoint kind, repair cache reads and a labelled USD estimate", () => {
    const { cost } = report();
    expect(cost.repairCacheRead).toBe(700);
    expect(cost.tokens.generator.cacheRead).toBe(3_000);
    expect(cost.estUsd).toBeGreaterThan(0);
    expect(cost.usdLabel).toBe(USD_LABEL);
    expect(cost.wallMsMedian).toBe(30_000);
  });

  it("states what the run did not measure and the noise floor", () => {
    const built = report();
    expect(built.notMeasured).toEqual(
      expect.arrayContaining(["audio", "accessibility", "multi-turn edits"]),
    );
    expect(built.noiseFloor).toContain("One generation per item.");
    expect(built.noiseFloor).toContain(
      "one item moves a band rate by 100 points",
    );
  });

  it("uses the §11.3 wording for five items per band", () => {
    const items = ["a", "b", "c", "d", "e"].flatMap((suffix) =>
      fixtureItems().map((item) => ({ ...item, id: `${item.id}-${suffix}` })),
    );
    const built = buildReport({
      tier: "full",
      label: "x",
      datasetVersion: "v1",
      items,
    });
    expect(built.noiseFloor).toBe(
      "One generation per item. With 5 items per band, one item moves a band rate by 20 points. Differences smaller than that are not interpretable.",
    );
  });
});

describe("report.md (§11.3)", () => {
  const markdown = renderMarkdown(report(), { scorerSha: "abc1234" });

  it("has every section, in order", () => {
    const positions = SECTION_ORDER.map((heading) => markdown.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(
      positions,
    );
  });

  it("names the tier, dataset, models, price table and scorer sha in the header", () => {
    expect(markdown).toContain("full");
    expect(markdown).toContain("v1");
    expect(markdown).toContain("claude-sonnet-5");
    expect(markdown).toContain("claude-haiku-4-5");
    expect(markdown).toContain("abc1234");
  });

  it("labels USD as an estimate and prints the E4 labelled-set note", () => {
    expect(markdown).toContain(USD_LABEL);
    expect(markdown).toContain(
      "measured on 40 authored bundles; the thresholds were set on the same bundles",
    );
  });

  it("has no 'all' row in any quality table", () => {
    const qualityStart = markdown.indexOf("### Quality");
    const qualityEnd = markdown.indexOf("## Repair loop");
    expect(markdown.slice(qualityStart, qualityEnd)).not.toMatch(/^\| all /m);
  });
});

describe("report.json (§11.3)", () => {
  it("validates against cartridge-report/1", () => {
    const parsed = ReportJson.parse(JSON.parse(serialiseReport(report())));
    expect(parsed.format).toBe("cartridge-report/1");
  });

  it("is deterministic: two builds give identical bytes", () => {
    expect(serialiseReport(report())).toBe(serialiseReport(report()));
    const shuffled = buildReport({
      tier: "full",
      label: "fixture",
      datasetVersion: "v1",
      items: [...fixtureItems()].reverse(),
    });
    expect(serialiseReport(shuffled)).toBe(serialiseReport(report()));
  });

  it("sorts items by id, sorts keys, rounds numbers and carries no timestamp", () => {
    const text = serialiseReport(report());
    const parsed = JSON.parse(text) as { items: { id: string }[] };
    expect(parsed.items.map((item) => item.id)).toEqual(
      [...parsed.items.map((item) => item.id)].sort(),
    );
    expect(text).toContain("0.917");
    expect(text).not.toContain("0.9166666");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text.endsWith("\n")).toBe(true);
    const keys = Object.keys(JSON.parse(text) as object);
    expect(keys).toEqual([...keys].sort());
  });
});
