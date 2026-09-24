import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { z } from "zod";
import { GameType } from "../contract/game-types.ts";
import { scoreGame } from "./e1/score.ts";
import { evaluateDetectors, type DetectorEntry } from "./e2/detectors.ts";
import { probeGame } from "./e2/probe.ts";
import {
  DetectorIdSchema,
  type DetectorId,
  type DetectorVerdict,
  type Observation,
} from "./e2/types.ts";

/** Repo root, derived from this file's location. */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Fixtures probed at once; low enough that frame timing is not starved (arbitrary). */
export const MATRIX_CONCURRENCY = 3;
const GOOD_PREFIX = "good-";
const HTML_SUFFIX = ".html";
const MANIFEST = "fixtures.json";

/** One entry of `fixtures/known-bad/fixtures.json` or `fixtures/holdout/fixtures.json` (§9.1). */
export const FixtureEntry = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    file: z.string().endsWith(HTML_SUFFIX),
    gameType: GameType,
    expectedDetector: DetectorIdSchema,
    allowedCoFires: z.array(DetectorIdSchema),
    coFireReason: z.string().min(1).optional(),
  })
  .refine((entry) => entry.allowedCoFires.length === 0 || entry.coFireReason, {
    message: "an allowed co-fire needs a one-line coFireReason",
  });
export type FixtureEntry = z.infer<typeof FixtureEntry>;

export type FixtureKind = "known-bad" | "good" | "holdout";

export interface MatrixFixture {
  readonly id: string;
  readonly kind: FixtureKind;
  readonly file: string;
  readonly gameType: GameType;
  readonly expectedDetector: DetectorId | null;
  readonly allowedCoFires: readonly DetectorId[];
}

/** One probed fixture: its E1 score and the raw E2 observation. */
export interface FixtureRun {
  readonly fixture: MatrixFixture;
  readonly e1Score: number;
  readonly observation: Observation;
}

export type MatrixVerdict =
  "caught" | "missed" | "clean" | "false-alarm" | "stray";

export interface MatrixRow {
  readonly e1Score: number;
  readonly expected: DetectorId | null;
  readonly fired: DetectorId[];
  readonly verdict: MatrixVerdict;
}

/** `reports/committed/matrix.json`: verdicts only, no raw metrics (§9.2). */
export interface MatrixReport {
  readonly tuning: Record<string, MatrixRow>;
  readonly holdout: Record<string, MatrixRow>;
}

export interface MatrixResult {
  readonly failures: string[];
  readonly report: MatrixReport;
}

function readManifest(dir: string, kind: FixtureKind): MatrixFixture[] {
  const path = join(dir, MANIFEST);
  if (!existsSync(path)) return [];
  const entries = z
    .array(FixtureEntry)
    .parse(JSON.parse(readFileSync(path, "utf8")));
  return entries.map((entry) => ({
    id: entry.id,
    kind,
    file: join(dir, entry.file),
    gameType: entry.gameType,
    expectedDetector: entry.expectedDetector,
    allowedCoFires: entry.allowedCoFires,
  }));
}

function readGood(dir: string): MatrixFixture[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(
      (name) => name.startsWith(GOOD_PREFIX) && name.endsWith(HTML_SUFFIX),
    )
    .sort()
    .map((name) => {
      const id = name.slice(0, -HTML_SUFFIX.length);
      const gameType = GameType.parse(id.slice(GOOD_PREFIX.length));
      return {
        id,
        kind: "good",
        file: join(dir, name),
        gameType,
        expectedDetector: null,
        allowedCoFires: [],
      };
    });
}

/**
 * Loads the tuning fixtures (known-bad and good) and, when present, the holdout set.
 * @param root repo root
 */
export function loadMatrixFixtures(root: string): MatrixFixture[] {
  const base = join(root, "fixtures");
  return [
    ...readManifest(join(base, "known-bad"), "known-bad"),
    ...readGood(join(base, "good")),
    ...readManifest(join(base, "holdout"), "holdout"),
  ];
}

function firedDetectors(
  verdicts: Record<DetectorId, DetectorVerdict>,
): DetectorId[] {
  return (Object.keys(verdicts) as DetectorId[])
    .filter((id) => verdicts[id] === "fail")
    .sort();
}

function rowVerdict(
  fixture: MatrixFixture,
  fired: readonly DetectorId[],
): MatrixVerdict {
  const expected = fixture.expectedDetector;
  if (expected === null) return fired.length === 0 ? "clean" : "false-alarm";
  if (!fired.includes(expected)) return "missed";
  const allowed = new Set<DetectorId>([expected, ...fixture.allowedCoFires]);
  return fired.every((id) => allowed.has(id)) ? "caught" : "stray";
}

function rowFor(
  run: FixtureRun,
  registry: readonly DetectorEntry[],
): MatrixRow {
  const fired = firedDetectors(evaluateDetectors(run.observation, registry));
  return {
    e1Score: run.e1Score,
    expected: run.fixture.expectedDetector,
    fired,
    verdict: rowVerdict(run.fixture, fired),
  };
}

function rowFailures(id: string, row: MatrixRow): string[] {
  const failures: string[] = [];
  if (row.e1Score !== 1)
    failures.push(`${id}: E1 score is ${String(row.e1Score)}, not 1.000`);
  if (row.verdict === "missed")
    failures.push(`${id}: missed ${String(row.expected)}`);
  if (row.verdict === "stray" || row.verdict === "false-alarm")
    failures.push(`${id}: unexpected detectors fired: ${row.fired.join(", ")}`);
  return failures;
}

function registryFailures(
  runs: readonly FixtureRun[],
  registry: readonly DetectorEntry[],
): string[] {
  const covered = new Set(
    runs
      .filter((run) => run.fixture.kind === "known-bad")
      .map((run) => run.fixture.expectedDetector),
  );
  return registry.flatMap((entry) => [
    ...(entry.enabled ? [] : [`${entry.id} is disabled`]),
    ...(covered.has(entry.id)
      ? []
      : [`${entry.id} is covered by no known-bad fixture`]),
  ]);
}

/**
 * Applies the §9.2 checks. Holdout rows are recorded but never fail the matrix (§9.3).
 * @param runs probed fixtures
 * @param registry detector registry (possibly with detectors disabled)
 */
export function evaluateMatrix(
  runs: readonly FixtureRun[],
  registry: readonly DetectorEntry[],
): MatrixResult {
  const tuning: Record<string, MatrixRow> = {};
  const holdout: Record<string, MatrixRow> = {};
  const failures: string[] = [];
  for (const run of runs) {
    const row = rowFor(run, registry);
    if (run.fixture.kind === "holdout") {
      holdout[run.fixture.id] = row;
      continue;
    }
    tuning[run.fixture.id] = row;
    failures.push(...rowFailures(run.fixture.id, row));
  }
  failures.push(...registryFailures(runs, registry));
  return { failures, report: { tuning, holdout } };
}

async function probeOne(
  browser: Browser,
  fixture: MatrixFixture,
): Promise<FixtureRun> {
  const html = readFileSync(fixture.file, "utf8");
  const observation = await probeGame(browser, html, {
    id: fixture.id,
    bot: null,
  });
  return { fixture, e1Score: scoreGame(html, {}).verdict.score, observation };
}

/**
 * Probes every fixture in headless Chromium (bot skipped: the matrix reads verdicts only).
 * @param fixtures fixtures to probe
 */
export async function probeFixtures(
  fixtures: readonly MatrixFixture[],
): Promise<FixtureRun[]> {
  const browser = await chromium.launch();
  try {
    const runs: FixtureRun[] = [];
    for (let index = 0; index < fixtures.length; index += MATRIX_CONCURRENCY) {
      const batch = fixtures.slice(index, index + MATRIX_CONCURRENCY);
      runs.push(
        ...(await Promise.all(
          batch.map((fixture) => probeOne(browser, fixture)),
        )),
      );
    }
    return runs;
  } finally {
    await browser.close();
  }
}
