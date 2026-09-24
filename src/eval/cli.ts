import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { GameSpec } from "../contract/spec.ts";
import { scoreGame } from "./e1/score.ts";

/** Output sinks, injectable for tests. */
export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const JSON_INDENT = 2;
const USAGE = "usage: cli.ts score --file <game.html> [--spec <spec.json>]\n";

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

/**
 * Runs the eval CLI. Only `score` exists in S1; `run` and `matrix` arrive with S3/S4.
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
  process.exitCode = runCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
