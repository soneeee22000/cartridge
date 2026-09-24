import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { main } from "../../src/eval/cli.ts";
import { DETECTORS, createRegistry } from "../../src/eval/e2/detectors.ts";
import {
  DETECTOR_IDS,
  type DetectorId,
  type Observation,
} from "../../src/eval/e2/types.ts";
import {
  REPO_ROOT,
  evaluateMatrix,
  loadMatrixFixtures,
  probeFixtures,
  type FixtureRun,
  type MatrixFixture,
} from "../../src/eval/matrix.ts";

const PROBE_BUDGET_MS = 300_000;

const clean: Observation = {
  staticType: "arcade-run",
  staticLang: "en",
  loadedAtMs: 0,
  messages: [
    {
      t: 50,
      data: {
        source: "cartridge",
        v: 1,
        type: "boot",
        payload: { title: "Reed Hop", gameType: "arcade-run", lang: "en" },
      },
    },
  ],
  idleStartMs: 500,
  idleEndMs: 6_500,
  frameA: { lumaStddev: 30, distinctColours: 80 },
  idleMotion: 0.03,
  tapMotion: 0.03,
  consoleErrors: [],
  longestPlaySeconds: null,
};

function fixture(
  id: string,
  kind: MatrixFixture["kind"],
  expectedDetector: DetectorId | null,
  allowedCoFires: DetectorId[] = [],
): MatrixFixture {
  return {
    id,
    kind,
    file: `${id}.html`,
    gameType: "arcade-run",
    expectedDetector,
    allowedCoFires,
  };
}

function run(
  item: MatrixFixture,
  observation: Partial<Observation> = {},
  e1Score = 1,
): FixtureRun {
  return { fixture: item, e1Score, observation: { ...clean, ...observation } };
}

const DEFECTS: Record<DetectorId, Partial<Observation>> = {
  "boot-handshake": { messages: [] },
  "blank-frame": { frameA: { lumaStddev: 0, distinctColours: 1 } },
  "idle-static": { idleMotion: 0 },
  "tap-unresponsive": { tapMotion: 0 },
  "idle-death": {
    messages: [
      ...clean.messages,
      {
        t: 600,
        data: {
          source: "cartridge",
          v: 1,
          type: "end",
          payload: { reason: "lose" },
        },
      },
    ],
  },
  "console-error": { consoleErrors: ["error: boom"] },
};

function fullSet(): FixtureRun[] {
  return [
    run(fixture("good-arcade-run", "good", null)),
    ...DETECTOR_IDS.map((id) =>
      run(fixture(`kb-${id}`, "known-bad", id), DEFECTS[id]),
    ),
  ];
}

describe("detection matrix checks (§9.2)", () => {
  it("passes a complete, clean set", () => {
    expect(evaluateMatrix(fullSet(), DETECTORS).failures).toEqual([]);
  });

  it("1: fails when a tuning fixture's E1 score is not 1.000", () => {
    const [first, ...rest] = fullSet();
    if (!first) throw new Error("empty set");
    const runs = [{ ...first, e1Score: 0.958 }, ...rest];
    expect(evaluateMatrix(runs, DETECTORS).failures.join("\n")).toMatch(/E1/);
  });

  it("2: fails when a known-bad fixture misses its detector", () => {
    const runs = fullSet().map((item) =>
      item.fixture.expectedDetector === "console-error"
        ? { ...item, observation: clean }
        : item,
    );
    expect(evaluateMatrix(runs, DETECTORS).failures.join("\n")).toMatch(
      /missed console-error/,
    );
  });

  it("3: fails on a co-fire outside the allowed set, and accepts an allowed one", () => {
    const noisy = run(fixture("kb-noisy", "known-bad", "idle-static"), {
      idleMotion: 0,
      tapMotion: 0,
    });
    const allowed = run(
      fixture("kb-allowed", "known-bad", "idle-static", ["tap-unresponsive"]),
      { idleMotion: 0, tapMotion: 0 },
    );
    expect(
      evaluateMatrix([...fullSet(), noisy], DETECTORS).failures.join("\n"),
    ).toMatch(/kb-noisy.*tap-unresponsive/);
    expect(evaluateMatrix([...fullSet(), allowed], DETECTORS).failures).toEqual(
      [],
    );
  });

  it("4: fails when a good control trips any detector", () => {
    const runs = [
      ...fullSet(),
      run(fixture("good-x", "good", null), { tapMotion: 0 }),
    ];
    expect(evaluateMatrix(runs, DETECTORS).failures.join("\n")).toMatch(
      /good-x/,
    );
  });

  it("5: fails when a detector is disabled or covered by no fixture", () => {
    const disabled = evaluateMatrix(fullSet(), createRegistry(["idle-death"]));
    expect(disabled.failures.join("\n")).toMatch(/idle-death is disabled/);
    const uncovered = fullSet().filter(
      (item) => item.fixture.expectedDetector !== "blank-frame",
    );
    expect(evaluateMatrix(uncovered, DETECTORS).failures.join("\n")).toMatch(
      /blank-frame is covered by no/,
    );
  });

  it("records holdout misses without failing", () => {
    const miss = run(fixture("ho-miss", "holdout", "console-error"));
    const result = evaluateMatrix([...fullSet(), miss], DETECTORS);
    expect(result.failures).toEqual([]);
    expect(result.report.holdout["ho-miss"]?.verdict).toBe("missed");
    expect(result.report.tuning["kb-console-error"]?.verdict).toBe("caught");
    expect(result.report.tuning["good-arcade-run"]?.verdict).toBe("clean");
  });
});

describe("eval:matrix on the committed fixtures (§9.2, mutant-style)", () => {
  let runs: FixtureRun[] = [];
  const cached = (): Promise<FixtureRun[]> => Promise.resolve(runs);

  function capture() {
    let out = "";
    let err = "";
    return {
      io: {
        stdout: (text: string) => {
          out += text;
        },
        stderr: (text: string) => {
          err += text;
        },
      },
      read: () => ({ out, err }),
    };
  }

  beforeAll(async () => {
    runs = await probeFixtures(loadMatrixFixtures(REPO_ROOT));
  }, PROBE_BUDGET_MS);

  it("exits 0 with nothing disabled and writes sorted verdicts", async () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "cartridge-matrix-")),
      "m.json",
    );
    const sink = capture();
    const code = await main(["matrix", "--json", path], sink.io, {
      probe: cached,
    });
    expect(sink.read().err).toBe("");
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(written)).toEqual(["holdout", "tuning"]);
    expect(JSON.stringify(written)).not.toContain("lumaStddev");
  });

  it.each(DETECTOR_IDS.map((id) => [id]))(
    "exits 1 when %s is disabled",
    async (id) => {
      const sink = capture();
      const code = await main(["matrix", "--disable", id], sink.io, {
        probe: cached,
      });
      expect(code).toBe(1);
      expect(sink.read().err).toContain(`${id} is disabled`);
    },
  );

  it("rejects an unknown detector id", async () => {
    const sink = capture();
    expect(
      await main(["matrix", "--disable", "nope"], sink.io, { probe: cached }),
    ).toBe(2);
  });
});
