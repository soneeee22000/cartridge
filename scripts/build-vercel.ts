import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

/** Vercel Node 24 runtime id for `.vc-config.json` (recorded in docs/research/deploy-and-models.md). */
export const VERCEL_RUNTIME = "nodejs24.x";
/** Hobby-plan cap on function duration; the replay stream must end before it (arbitrary cap within the plan limit). */
export const MAX_DURATION_SECONDS = 300;
/** Runtime asset directories copied next to each function, relative to the repo root. */
export const ASSET_DIRS = [
  "src/cards",
  "src/engine/prompts",
  "cassettes",
  "dataset",
  "reports/committed",
] as const;

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const JSON_INDENT = 2;
const HANDLER_FILE = "index.mjs";
const BANNER = [
  'import { createRequire as __cartridgeCreateRequire } from "node:module";',
  'import { dirname as __cartridgeDirname } from "node:path";',
  'import { fileURLToPath as __cartridgeFileUrl } from "node:url";',
  "const require = __cartridgeCreateRequire(import.meta.url);",
  "process.env.CARTRIDGE_ASSET_ROOT ??= __cartridgeDirname(__cartridgeFileUrl(import.meta.url));",
].join("\n");

function copyAssets(root: string, functionDir: string): void {
  for (const dir of ASSET_DIRS) {
    const source = join(root, dir);
    if (existsSync(source))
      cpSync(source, join(functionDir, dir), { recursive: true });
  }
}

function vcConfig(): string {
  const config = {
    runtime: VERCEL_RUNTIME,
    handler: HANDLER_FILE,
    launcherType: "Nodejs",
    maxDuration: MAX_DURATION_SECONDS,
    supportsResponseStreaming: true,
  };
  return `${JSON.stringify(config, null, JSON_INDENT)}\n`;
}

async function buildFunction(
  root: string,
  outDir: string,
  entry: string,
): Promise<string> {
  const name = basename(entry, ".ts");
  const functionDir = join(outDir, "functions", "api", `${name}.func`);
  mkdirSync(functionDir, { recursive: true });
  await build({
    entryPoints: [join(root, "api", entry)],
    outfile: join(functionDir, HANDLER_FILE),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: { js: BANNER },
    logLevel: "warning",
  });
  writeFileSync(join(functionDir, ".vc-config.json"), vcConfig());
  copyAssets(root, functionDir);
  return functionDir;
}

/**
 * Bundles every `api/*.ts` into a Build Output API function directory (§13.3).
 * @param root repo root
 * @param outDir output directory, normally `.vercel/output`
 * @returns the function directories written
 */
export async function buildVercel(
  root: string,
  outDir: string,
): Promise<string[]> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "config.json"),
    `${JSON.stringify({ version: 3 }, null, JSON_INDENT)}\n`,
  );
  const entries = readdirSync(join(root, "api")).filter((file) =>
    file.endsWith(".ts"),
  );
  const built: string[] = [];
  for (const entry of entries)
    built.push(await buildFunction(root, outDir, entry));
  return built;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const outDir = resolve(values.out ?? join(REPO_ROOT, ".vercel", "output"));
  const built = await buildVercel(REPO_ROOT, outDir);
  for (const dir of built) process.stdout.write(`built ${dir}\n`);
}
