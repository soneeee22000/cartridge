import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { GameSpec } from "../contract/spec.ts";
import { canonicalJson } from "../models/request-key.ts";
import { scoreGame } from "./e1/score.ts";
import { createRegistry, toE2Result } from "./e2/detectors.ts";
import { DETECTOR_IDS, DetectorIdSchema, type DetectorId } from "./e2/types.ts";
import {
  REPO_ROOT,
  evaluateMatrix,
  loadMatrixFixtures,
  probeFixtures,
  type FixtureRun,
  type MatrixFixture,
} from "./matrix.ts";
import type { EvalDeps } from "./run/deps.ts";

/** Output sinks, injectable for tests. */
export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const METRIC_DECIMALS = 4;
const JSON_INDENT = 2;
const USAGE = [
  "usage: cli.ts run --tier <one|sample|full> [--mode live|record|replay|mock] [--label <s>] [--json <path>] [--yes --max-usd <n>] [--skip-e2]",
  "       cli.ts score --games <dir> [--tier <t>] [--label <s>] [--json <path>] [--rerun-e2]",
  "       cli.ts score --file <game.html> [--spec <spec.json>]",
  "       cli.ts matrix [--json <matrix.json>] [--disable <detector-id>]...",
  "",
].join("\n");

function readSpec(path: string | undefined): GameSpec | undefined {
  if (path === undefined) return undefined;
  return GameSpec.parse(JSON.parse(readFileSync(path, "utf8")));
}

function scoreCommand(args: string[], io: CliIo): number {
  const { values } = parseArgs({
    args,
    options: { file: { type: "string" }, spec: { type: "string" } },
    strict: true,
  });
  if (!values.file || !existsSync(values.file)) {
    io.stderr(values.file ? `no such file: ${values.file}\n` : USAGE);
    return EXIT_USAGE;
  }
  const spec = readSpec(values.spec);
  const report = scoreGame(
    readFileSync(values.file, "utf8"),
    spec ? { spec } : {},
  );
  const printed = {
    file: values.file,
    verdict: report.verdict,
    metrics: report.metrics,
    results: report.results,
  };
  io.stdout(`${JSON.stringify(printed, null, JSON_INDENT)}\n`);
  return EXIT_OK;
}

/** Injectable collaborators for the async commands. */
export interface CliDeps {
  readonly probe?: (
    fixtures: readonly MatrixFixture[],
  ) => Promise<FixtureRun[]>;
  readonly evalDeps?: EvalDeps;
}

function parseDisabled(values: readonly string[]): DetectorId[] | null {
  const parsed = values.map((value) => DetectorIdSchema.safeParse(value));
  if (parsed.some((result) => !result.success)) return null;
  return parsed.flatMap((result) => (result.success ? [result.data] : []));
}

function formatMetric(value: number | null): string {
  return value === null ? "-" : String(Number(value.toFixed(METRIC_DECIMALS)));
}

function metricsLine(run: FixtureRun): string {
  const { metrics } = toE2Result(run.observation, createRegistry());
  const fields = Object.entries(metrics).map(
    ([key, value]) => `${key}=${formatMetric(value)}`,
  );
  return `${run.fixture.id} e1=${String(run.e1Score)} ${fields.join(" ")}`;
}

function writeReport(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const sorted: unknown = JSON.parse(canonicalJson(value));
  writeFileSync(path, `${JSON.stringify(sorted, null, JSON_INDENT)}\n`);
}

function parseMatrixArgs(args: string[]) {
  return parseArgs({
    args,
    options: {
      json: { type: "string" },
      disable: { type: "string", multiple: true },
    },
    strict: true,
  }).values;
}

async function matrixCommand(
  args: string[],
  io: CliIo,
  deps: CliDeps,
): Promise<number> {
  const values = parseMatrixArgs(args);
  const disabled = parseDisabled(values.disable ?? []);
  if (!disabled) {
    io.stderr(
      `unknown detector; expected one of: ${DETECTOR_IDS.join(", ")}\n`,
    );
    return EXIT_USAGE;
  }
  const probe = deps.probe ?? probeFixtures;
  const runs = await probe(loadMatrixFixtures(REPO_ROOT));
  const result = evaluateMatrix(runs, createRegistry(disabled));
  io.stdout(`${runs.map(metricsLine).join("\n")}\n`);
  if (values.json) writeReport(values.json, result.report);
  if (result.failures.length === 0) return EXIT_OK;
  const lines = result.failures.map((line) => `  ${line}\n`).join("");
  io.stderr(`matrix failed:\n${lines}`);
  return EXIT_FAILED;
}

/**
 * Runs any eval CLI command: `run`, `score --games` (rescore), `matrix` and `score --file` (§9.2, §12).
 * @param argv arguments after the script name
 * @param io output sinks
 * @param deps injectable collaborators (tests pass a cached probe)
 * @returns the process exit code
 */
export async function main(
  argv: string[],
  io: CliIo,
  deps: CliDeps = {},
): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "matrix") return matrixCommand(rest, io, deps);
  const rescore = command === "score" && rest.includes("--games");
  if (command !== "run" && !rescore) return runCli(argv, io);
  const { runCommand, rescoreCommand } = await import("./run/command.ts");
  const { defaultEvalDeps } = await import("./run/deps.ts");
  const evalDeps = deps.evalDeps ?? defaultEvalDeps(process.env);
  return rescore
    ? rescoreCommand(rest, io, evalDeps)
    : runCommand(rest, io, evalDeps);
}

/**
 * Runs a synchronous eval command (`score`).
 * @param argv arguments after the script name
 * @param io output sinks
 * @returns the process exit code
 */
export function runCli(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;
  if (command === "score") return scoreCommand(rest, io);
  io.stderr(USAGE);
  return EXIT_USAGE;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await main(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
