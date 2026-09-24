import { describe, expect, it } from "vitest";
import { fullReport } from "../data/report";
import {
  failedDetectors,
  headlineFacts,
  repairedItem,
  runtimeFailures,
} from "./results";

describe("headline facts from full.json", () => {
  const facts = headlineFacts(fullReport);

  it("counts 20 of 20 items built, all with E1 1.000", () => {
    expect([facts.games, facts.items, facts.e1Perfect]).toEqual([20, 20, 20]);
  });

  it("counts 11 of 20 games passing E2, and agrees with the per-item verdicts", () => {
    expect([facts.e2Passed, facts.e2Probed]).toEqual([11, 20]);
    expect(facts.staticPerfectRuntimeFail).toBe(
      facts.e2Probed - facts.e2Passed,
    );
    expect(facts.staticPerfectRuntimeFail).toBe(9);
  });

  it("carries the estimate and its label verbatim", () => {
    expect(facts.estUsd).toBe(3.15);
    expect(facts.usdLabel).toBe("estimate from list prices; not an invoice");
  });

  it("counts the items that went through a repair", () => {
    expect(facts.repaired).toBe(5);
  });
});

describe("runtime failures", () => {
  it("lists the nine statically perfect games that failed E2, each with its detectors", () => {
    const failures = runtimeFailures(fullReport);
    expect(failures).toHaveLength(9);
    expect(failures.every((failure) => failure.detectors.length > 0)).toBe(
      true,
    );
    expect(
      failures.find((failure) => failure.id === "maze-de-haies")?.detectors,
    ).toEqual(["tap-unresponsive", "console-error"]);
  });

  it("reports no failed detectors for a game that passed", () => {
    const passing = fullReport.items.find((item) => item.id === "tile-sort");
    expect(passing && failedDetectors(passing)).toEqual([]);
  });
});

describe("repaired item", () => {
  it("finds a recorded repair triggered by E1-24", () => {
    const item = repairedItem(fullReport, "E1-24");
    expect(item.repairRules).toContain("E1-24");
    expect(item.buildAttempts).toBe(2);
  });
});
