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
const mod = await import(process.argv[1]);
const response = await mod.GET(new Request("https://cartridge.test/api/replay"));
process.stdout.write(JSON.stringify({ status: response.status, body: await response.json(), node: typeof mod.default }));
`;

describe("build:vercel (§13.3)", () => {
  it(
    "bundles a function that reads a card in plain Node, away from the repo",
    async () => {
      const outDir = join(
        mkdtempSync(join(tmpdir(), "cartridge-vercel-")),
        "output",
      );
      const [functionDir] = await buildVercel(REPO_ROOT, outDir);
      expect(functionDir).toMatch(/replay\.func$/);
      const dir = functionDir ?? "";
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
          pathToFileURL(join(dir, "index.mjs")).href,
        ],
        { cwd: tmpdir(), env, encoding: "utf8" },
      );
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        status: 200,
        body: {
          placeholder: true,
          card: "bridge",
          title: "Bridge",
          lines: expect.any(Number) as number,
        },
        node: "function",
      });
    },
    BUILD_TIMEOUT_MS,
  );
});
