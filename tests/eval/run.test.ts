import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manualClock } from "../../src/engine/clock.ts";
import { main } from "../../src/eval/cli.ts";
import { DATASET_PATH } from "../../src/eval/dataset/schema.ts";
import type { E2Result } from "../../src/eval/e2/types.ts";
import { ReportJson } from "../../src/eval/report/types.ts";
import type { EvalDeps } from "../../src/eval/run/deps.ts";
import { RunRecord } from "../../src/eval/run/record.ts";
import { ONE_ITEM_ID, SAMPLE_ITEM_IDS } from "../../src/eval/tiers.ts";
import {
  MOCK_GAME_HTML,
  MOCK_SPEC,
  scriptedTurns,
} from "../../src/models/mock.ts";

const BROKEN_GAME = MOCK_GAME_HTML.replace('CARTRIDGE.send("start");', "");
const E2_PASS: E2Result = {
  detectors: {
    "boot-handshake": "pass",
    "blank-frame": "pass",
    "idle-static": "pass",
    "tap-unresponsive": "pass",
    "idle-death": "pass",
    "console-error": "pass",
  },
  metrics: {
    bootMs: 90,
    lumaStddev: 20,
    distinctColours: 12,
    idleMotionRatio: 0.02,
    tapMotionRatio: 0.03,
    firstEndSeconds: null,
  },
  longestPlaySeconds: 9.5,
  consoleErrors: [],
};

const titleLine =
  MOCK_GAME_HTML.split("\n").findIndex((line) => line.includes("<title>")) + 1;
const JUDGE_RESPONSE = JSON.stringify({
  "prompt-coverage": null,
  "goal-legibility": {
    label: "implied",
    evidence: [{ line: titleLine, quote: "<title>Lantern Dash</title>" }],
    rationale: "Only the title hints at the goal.",
  },
  "feedback-on-input": null,
  "fail-state-clarity": null,
});

interface Harness {
  readonly deps: EvalDeps;
  readonly probed: string[];
}

function harness(overrides: Partial<EvalDeps> = {}): Harness {
  const probed: string[] = [];
  const deps: EvalDeps = {
    root: mkdtempSync(join(tmpdir(), "cartridge-eval-")),
    datasetPath: DATASET_PATH,
    clock: manualClock(1_000),
    env: {},
    timeoutMs: 60_000,
    pricesChecked: null,
    generatorModels: () => ({
      planner: scriptedTurns([
        { kind: "text", text: JSON.stringify(MOCK_SPEC) },
      ]),
      builder: scriptedTurns([
        { kind: "tool", tool: "save_draft", input: { html: BROKEN_GAME } },
        { kind: "text", text: "Saved." },
        { kind: "tool", tool: "save_draft", input: { html: MOCK_GAME_HTML } },
        { kind: "text", text: "Fixed." },
      ]),
    }),
    judgeModel: () =>
      scriptedTurns([
        {
          kind: "text",
          text: JUDGE_RESPONSE,
          usage: { input: 50, output: 10 },
        },
      ]),
    probe: (_html, itemId) => {
      probed.push(itemId);
      return Promise.resolve(E2_PASS);
    },
    scorerSha: () => "test-sha",
    ...overrides,
  };
  return { deps, probed };
}

async function capture(argv: string[], deps: EvalDeps) {
  let out = "";
  let err = "";
  const code = await main(
    argv,
    {
      stdout: (text) => {
        out += text;
      },
      stderr: (text) => {
        err += text;
      },
    },
    { evalDeps: deps },
  );
  return { code, out, err };
}

describe("cli run (§12.2)", () => {
  it("runs the one tier end to end in mock mode and persists every file per item", async () => {
    const { deps, probed } = harness();
    const { code, out } = await capture(
      ["run", "--tier", "one", "--mode", "mock"],
      deps,
    );
    expect(code).toBe(0);
    expect(out).toMatch(
      /^estimate: 1 items, about \$[\d.]+ \(estimate from list prices; not an invoice/,
    );
    const dir = join(deps.root, "games", ONE_ITEM_ID);
    const record = RunRecord.parse(
      JSON.parse(readFileSync(join(dir, "run.json"), "utf8")),
    );
    expect(record).toMatchObject({
      status: "complete",
      buildAttempts: 2,
      repairRules: ["E1-13"],
    });
    expect(existsSync(join(dir, "a0.html"))).toBe(true);
    expect(existsSync(join(dir, "a1.html"))).toBe(true);
    expect(existsSync(join(dir, "e2.json"))).toBe(true);
    expect(probed).toEqual([ONE_ITEM_ID]);
    const reportDir = join(deps.root, "reports", "one", "latest");
    const report = ReportJson.parse(
      JSON.parse(readFileSync(join(reportDir, "report.json"), "utf8")),
    );
    expect(report.items[0]).toMatchObject({
      id: ONE_ITEM_ID,
      outcome: "game",
      e1Score: 1,
    });
    expect(report.items[0]?.e3?.dimensions["goal-legibility"]).toBe("implied");
    expect(readFileSync(join(reportDir, "report.md"), "utf8")).toContain(
      "## Noise floor",
    );
  });

  it("regenerates the same report.json byte for byte with score --games and no key", async () => {
    const { deps } = harness();
    await capture(["run", "--tier", "one", "--mode", "mock"], deps);
    const committed = readFileSync(
      join(deps.root, "reports", "one", "latest", "report.json"),
      "utf8",
    );
    const out = join(deps.root, "rescored.json");
    const { code } = await capture(
      [
        "score",
        "--games",
        join(deps.root, "games"),
        "--tier",
        "one",
        "--json",
        out,
      ],
      deps,
    );
    expect(code).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(committed);
  });

  it("fails the rescore when an item was never run", async () => {
    const { deps } = harness();
    const { code, err } = await capture(
      ["score", "--games", join(deps.root, "games"), "--tier", "one"],
      deps,
    );
    expect(code).toBe(1);
    expect(err).toContain(ONE_ITEM_ID);
  });

  it("records a refusal separately and exits 0", async () => {
    const { deps } = harness({
      generatorModels: () => ({
        planner: scriptedTurns([
          { kind: "text", text: "no", finishReason: "content-filter" },
        ]),
        builder: scriptedTurns([]),
      }),
    });
    const { code, out } = await capture(
      ["run", "--tier", "one", "--mode", "mock", "--skip-e2"],
      deps,
    );
    expect(code).toBe(0);
    expect(out).toContain("refusal");
  });

  it("exits 1 on a harness failure in the one tier", async () => {
    const { deps } = harness({
      generatorModels: () => ({
        planner: scriptedTurns([
          { kind: "error", error: new TypeError("boom") },
        ]),
        builder: scriptedTurns([]),
      }),
    });
    const { code, out } = await capture(
      ["run", "--tier", "one", "--mode", "mock", "--skip-e2"],
      deps,
    );
    expect(out).toContain("harness-failure");
    expect(code).toBe(1);
  });

  it("refuses paid modes until prices are re-checked, and without a key", async () => {
    const unchecked = await capture(["run", "--tier", "one"], harness().deps);
    expect(unchecked.code).toBe(2);
    expect(unchecked.err).toContain("official Anthropic pricing page");
    const noKey = await capture(
      ["run", "--tier", "one", "--mode", "record"],
      harness({ pricesChecked: "2026-09-24" }).deps,
    );
    expect(noKey.code).toBe(2);
    expect(noKey.err).toContain("ANTHROPIC_API_KEY");
  });

  it("starts a record run from an empty game and cassette directory for the item", async () => {
    const { deps } = harness({
      pricesChecked: "2026-09-24",
      env: { ANTHROPIC_API_KEY: "test-key" },
    });
    const gameDir = join(deps.root, "games", ONE_ITEM_ID);
    const cassetteDir = join(deps.root, "cassettes", ONE_ITEM_ID);
    mkdirSync(gameDir, { recursive: true });
    mkdirSync(cassetteDir, { recursive: true });
    writeFileSync(join(gameDir, "a3.html"), "stale");
    writeFileSync(join(cassetteDir, "index.json"), '{"keys":["stale"]}\n');
    const { code } = await capture(
      ["run", "--tier", "one", "--mode", "record", "--skip-e2"],
      deps,
    );
    expect(code).toBe(0);
    expect(existsSync(join(gameDir, "a3.html"))).toBe(false);
    expect(existsSync(join(cassetteDir, "index.json"))).toBe(false);
    expect(existsSync(join(gameDir, "a1.html"))).toBe(true);
  });

  it("never clears recordings outside record mode", async () => {
    const { deps } = harness();
    const cassetteDir = join(deps.root, "cassettes", ONE_ITEM_ID);
    mkdirSync(cassetteDir, { recursive: true });
    writeFileSync(join(cassetteDir, "index.json"), '{"keys":[]}\n');
    await capture(
      ["run", "--tier", "one", "--mode", "mock", "--skip-e2"],
      deps,
    );
    expect(existsSync(join(cassetteDir, "index.json"))).toBe(true);
  });

  it("refuses the full tier without --yes and --max-usd", async () => {
    const noYes = await capture(
      ["run", "--tier", "full", "--mode", "mock"],
      harness().deps,
    );
    expect(noYes).toMatchObject({ code: 2 });
    expect(noYes.err).toContain("--yes");
    const noCap = await capture(
      ["run", "--tier", "full", "--mode", "mock", "--yes"],
      harness().deps,
    );
    expect(noCap.err).toContain("--max-usd");
  });

  it("stops before the next item once the running estimate passes --max-usd", async () => {
    const { deps } = harness({
      generatorModels: () => ({
        planner: scriptedTurns([
          {
            kind: "text",
            text: JSON.stringify(MOCK_SPEC),
            usage: { input: 10_000_000, output: 0 },
          },
        ]),
        builder: scriptedTurns([
          { kind: "tool", tool: "save_draft", input: { html: MOCK_GAME_HTML } },
        ]),
      }),
    });
    const { err, out } = await capture(
      [
        "run",
        "--tier",
        "full",
        "--mode",
        "mock",
        "--yes",
        "--max-usd",
        "1",
        "--skip-e2",
      ],
      deps,
    );
    expect(err).toContain("--max-usd");
    expect(
      out.match(/: (game|contract-failed|refusal|harness-failure)/g),
    ).toHaveLength(1);
  });

  it("rejects an unknown tier", async () => {
    const { code, err } = await capture(
      ["run", "--tier", "huge"],
      harness().deps,
    );
    expect(code).toBe(2);
    expect(err).toContain("--tier");
  });

  it("runs the sample tier: the four sample items, in order", async () => {
    const { deps, probed } = harness();
    const { code, out } = await capture(
      ["run", "--tier", "sample", "--mode", "mock"],
      deps,
    );
    expect(code).toBe(0);
    expect(out).toMatch(/^estimate: 4 items/);
    expect(probed).toEqual([...SAMPLE_ITEM_IDS]);
    const report = ReportJson.parse(
      JSON.parse(
        readFileSync(
          join(deps.root, "reports", "sample", "latest", "report.json"),
          "utf8",
        ),
      ),
    );
    expect(report.items.map((item) => item.id)).toEqual(
      [...SAMPLE_ITEM_IDS].sort(),
    );
    expect(report.bands.map((row) => row.n)).toEqual([1, 1, 1, 1]);
  });
});
