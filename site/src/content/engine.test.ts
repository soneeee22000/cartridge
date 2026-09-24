import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_TOOLS,
  CARD_KINDS,
  ENGINE_CONSTANTS,
  ENGINE_CONSTANT_FILES,
  RUN_STATUSES,
} from "./engine";

const REPO_ROOT = new URL("../../../", import.meta.url);

/** A repo file's text. */
function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, REPO_ROOT)), "utf8");
}

describe("engine constants quoted on the page", () => {
  it.each(Object.entries(ENGINE_CONSTANTS))(
    "%s matches the engine source",
    (name, value) => {
      const file = ENGINE_CONSTANT_FILES[name as keyof typeof ENGINE_CONSTANTS];
      const match = new RegExp(`export const ${name} = ([0-9_]+);`).exec(
        source(file),
      );
      expect(match, `${name} in ${file}`).not.toBeNull();
      expect(Number(match?.[1]?.replaceAll("_", ""))).toBe(value);
    },
  );

  it("lists exactly the cards in src/cards", () => {
    const files = readdirSync(fileURLToPath(new URL("src/cards/", REPO_ROOT)))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/, ""));
    expect(Object.values(CARD_KINDS).flat().toSorted()).toEqual(
      files.toSorted(),
    );
  });

  it("names the agent tools that exist", () => {
    for (const tool of AGENT_TOOLS)
      expect(
        source("src/engine/tools/index.ts") +
          source(`src/engine/tools/${tool.replace("_", "-")}.ts`),
      ).toContain(`"${tool}"`);
  });

  it("uses the run table's status names", () => {
    const lifecycle = source("src/engine/lifecycle.ts");
    for (const status of RUN_STATUSES)
      expect(lifecycle).toContain(`"${status}"`);
  });
});
