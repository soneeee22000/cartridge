import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_DURATION_SECONDS,
  VERCEL_RUNTIME,
  buildVercel,
} from "../../scripts/build-vercel.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUILD_TIMEOUT_MS = 60_000;

const PROBE = `
const prompts = await import(process.argv[1]);
const replay = await import(process.argv[2]);
const list = await prompts.GET(new Request("https://cartridge.test/api/prompts"));
const unknown = await replay.GET(new Request("https://cartridge.test/api/replay?promptId=not-an-item"));
const abort = new AbortController();
const stream = await replay.GET(new Request("https://cartridge.test/api/replay?promptId=bubble-pop", { signal: abort.signal }));
const reader = stream.body.getReader();
const first = new TextDecoder().decode((await reader.read()).value);
abort.abort();
await reader.cancel();
process.stdout.write(JSON.stringify({
  prompts: list.status,
  items: (await list.json()).items.length,
  unknown: unknown.status,
  stream: stream.headers.get("content-type"),
  firstEvent: first.includes("event: progress"),
  node: typeof replay.default,
}));
process.exit(0);
`;

describe("build:vercel (§13.3)", () => {
  it(
    "bundles the replay and prompts functions so they run keyless in plain Node, away from the repo",
    async () => {
      const outDir = join(
        mkdtempSync(join(tmpdir(), "cartridge-vercel-")),
        "output",
      );
      const built = await buildVercel(REPO_ROOT, outDir);
      const dir = built.find((path) => path.endsWith("replay.func")) ?? "";
      const promptsDir =
        built.find((path) => path.endsWith("prompts.func")) ?? "";
      expect(dir).not.toBe("");
      expect(promptsDir).not.toBe("");
      const config = JSON.parse(
        readFileSync(join(dir, ".vc-config.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(config).toMatchObject({
        runtime: VERCEL_RUNTIME,
        handler: "index.mjs",
        launcherType: "Nodejs",
        maxDuration: MAX_DURATION_SECONDS,
      });
      expect(existsSync(join(dir, "src", "cards", "bridge.md"))).toBe(true);
      expect(
        existsSync(join(dir, "reports", "committed", "full.json")),
      ).toBe(true);
      expect(existsSync(join(outDir, "config.json"))).toBe(true);

      const env = { ...process.env };
      delete env.CARTRIDGE_ASSET_ROOT;
      delete env.ANTHROPIC_API_KEY;
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          PROBE,
          pathToFileURL(join(promptsDir, "index.mjs")).href,
          pathToFileURL(join(dir, "index.mjs")).href,
        ],
        { cwd: tmpdir(), env, encoding: "utf8" },
      );
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        prompts: 200,
        items: 20,
        unknown: 404,
        stream: "text/event-stream",
        firstEvent: true,
        node: "function",
      });
    },
    BUILD_TIMEOUT_MS,
  );
});
