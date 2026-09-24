import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCANNED = ["src/engine", "src/models"];

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function hasTopLevelMutable(text: string): boolean {
  const source = ts.createSourceFile("scan.ts", text, ts.ScriptTarget.Latest);
  return source.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0,
  );
}

describe("no module-level mutable state in the engine (§4.6)", () => {
  it("has no top-level let or var in src/engine or src/models", () => {
    const offenders = SCANNED.flatMap((dir) => tsFiles(join(ROOT, dir)))
      .filter((path) => hasTopLevelMutable(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  it("flags let and var but not const or let inside a string", () => {
    expect(hasTopLevelMutable("let counter = 0;")).toBe(true);
    expect(hasTopLevelMutable("export var shared = 1;")).toBe(true);
    expect(hasTopLevelMutable("const page = `let lane = 0;`;")).toBe(false);
  });
});
