import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FORBIDDEN = [
  /(^|\/)src\/models\/port\.ts$/,
  /(^|\/)src\/server\/dev\.ts$/,
  /@libsql\//,
  /(^|\/)node_modules\/playwright/,
  /(^|\/)src\/eval\/e2\//,
];

async function bundledInputs(entry: string): Promise<string[]> {
  const result = await build({
    entryPoints: [join(REPO_ROOT, "api", entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  return Object.keys(result.metafile.inputs).map((path) =>
    path.replaceAll("\\", "/"),
  );
}

describe("api/** import graph (ADR-0003)", () => {
  const entries = readdirSync(join(REPO_ROOT, "api")).filter((file) =>
    file.endsWith(".ts"),
  );

  it.each(entries)(
    "%s cannot reach the live or record model paths, libsql or playwright",
    async (entry) => {
      const inputs = await bundledInputs(entry);
      expect(inputs.length).toBeGreaterThan(0);
      for (const pattern of FORBIDDEN)
        expect(
          inputs.filter((path) => pattern.test(path)),
          String(pattern),
        ).toEqual([]);
    },
  );
});
