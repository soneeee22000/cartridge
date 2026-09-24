import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";

const SITE_DIR = resolve(import.meta.dirname, "..");
const API_SCRIPT = resolve(SITE_DIR, "..", "scripts", "site-api.ts");
const VITE_BIN = resolve(SITE_DIR, "node_modules", "vite", "bin", "vite.js");
const MODES = ["dev", "preview"] as const;

type Mode = (typeof MODES)[number];

/** Parse the first CLI argument as dev or preview. */
function parseMode(raw: string | undefined): Mode {
  const mode = MODES.find((candidate) => candidate === raw);
  if (mode === undefined)
    throw new Error(`usage: dev-stack.ts <${MODES.join("|")}>`);
  return mode;
}

/** Start a child Node process that shares this terminal. */
function start(args: readonly string[]): ChildProcess {
  return spawn(process.execPath, args, { cwd: SITE_DIR, stdio: "inherit" });
}

/**
 * Run the keyless replay API and the Vite dev or preview server together, so `/api` proxies to
 * the same handlers the deploy bundle uses. Ctrl+C stops both.
 */
function main(): void {
  const mode = parseMode(process.argv[2]);
  const viteArgs = mode === "dev" ? [VITE_BIN] : [VITE_BIN, "preview"];
  const children = [start([API_SCRIPT]), start(viteArgs)];
  const stop = (): void => {
    for (const child of children) child.kill();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (const child of children) child.on("exit", stop);
}

main();
