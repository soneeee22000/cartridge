import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GAME_TYPES } from "../../src/contract/game-types.ts";
import { scoreGame } from "../../src/eval/e1/score.ts";
import { DETECTOR_IDS } from "../../src/eval/e2/types.ts";
import {
  FixtureEntry,
  REPO_ROOT,
  loadMatrixFixtures,
} from "../../src/eval/matrix.ts";

const fixtures = loadMatrixFixtures(REPO_ROOT);

describe("tuning fixtures (§9.1)", () => {
  it("has six known-bad fixtures, one per detector", () => {
    const knownBad = fixtures.filter((fixture) => fixture.kind === "known-bad");
    expect(knownBad).toHaveLength(DETECTOR_IDS.length);
    expect(knownBad.map((fixture) => fixture.expectedDetector).sort()).toEqual(
      [...DETECTOR_IDS].sort(),
    );
  });

  it("has six holdout fixtures, one per detector (§9.3)", () => {
    const holdout = fixtures.filter((fixture) => fixture.kind === "holdout");
    expect(holdout.map((fixture) => fixture.expectedDetector).sort()).toEqual(
      [...DETECTOR_IDS].sort(),
    );
  });

  it("has one good control per game type", () => {
    const good = fixtures.filter((fixture) => fixture.kind === "good");
    expect(good.map((fixture) => fixture.gameType).sort()).toEqual(
      [...GAME_TYPES].sort(),
    );
    expect(good.every((fixture) => fixture.expectedDetector === null)).toBe(
      true,
    );
  });

  it.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
    "%s scores E1 = 1.000 and declares its manifest type",
    (_id, fixture) => {
      const report = scoreGame(readFileSync(fixture.file, "utf8"), {});
      const failed = report.results.filter(
        (result) => result.status === "fail",
      );
      expect(failed.map((result) => result.ruleId)).toEqual([]);
      expect(report.verdict.score).toBe(1);
      expect(readFileSync(fixture.file, "utf8")).toContain(
        `gameType: "${fixture.gameType}"`,
      );
    },
  );

  it("requires a reason for any allowed co-fire", () => {
    const base = {
      id: "kb-x",
      file: "kb-x.html",
      gameType: "arcade-run",
      expectedDetector: "idle-static",
    };
    expect(
      FixtureEntry.safeParse({ ...base, allowedCoFires: [] }).success,
    ).toBe(true);
    expect(
      FixtureEntry.safeParse({ ...base, allowedCoFires: ["blank-frame"] })
        .success,
    ).toBe(false);
    expect(
      FixtureEntry.safeParse({
        ...base,
        allowedCoFires: ["blank-frame"],
        coFireReason: "one colour cannot move",
      }).success,
    ).toBe(true);
  });
});
