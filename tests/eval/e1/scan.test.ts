import { describe, expect, it } from "vitest";
import { findCallSites, lexSource } from "../../../src/eval/e1/scan.ts";

function sites(source: string) {
  return findCallSites(lexSource(source));
}

describe("lexSource (§2.3 payload scan)", () => {
  it("masks comments and string contents but keeps length and newlines", () => {
    const source = 'a = "x{y}"; // c { \n/* { */ b = `t{`;';
    const { masked } = lexSource(source);
    expect(masked).toHaveLength(source.length);
    expect(masked.split("\n")).toHaveLength(2);
    expect(masked).not.toContain("{");
    expect(masked).toContain('"');
  });

  it("records string literal values and marks templates with substitutions as dynamic", () => {
    const { literals } = lexSource('f("it\\"s", `plain`, `n=${n + "}"}`);');
    expect(literals.map((literal) => literal.value)).toEqual([
      'it"s',
      "plain",
      'n=${n + "}"}',
    ]);
    expect(literals.map((literal) => literal.dynamic)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("treats a slash after an operator as a regex literal", () => {
    const { masked } = lexSource(
      'const r = /["{]/g; const s = a / b; x = "q";',
    );
    expect(masked).not.toContain("{");
    expect(masked).toContain("a / b");
  });
});

describe("findCallSites", () => {
  it("finds a call with a static event name and parses its payload", () => {
    const [site] = sites(
      'CARTRIDGE.send("score", { value: points, bonus: 2, tag: "x" });',
    );
    expect(site?.event).toBe("score");
    expect(site?.payload?.get("value")).toEqual({
      kind: "expression",
      text: "points",
    });
    expect(site?.payload?.get("bonus")).toEqual({ kind: "number", value: 2 });
    expect(site?.payload?.get("tag")).toEqual({ kind: "string", value: "x" });
  });

  it("handles a call without a payload and one with a non-literal payload", () => {
    const found = sites(
      'CARTRIDGE.send("start"); CARTRIDGE.send("score", state);',
    );
    expect(
      found.map((site) => [site.event, site.payload, site.hasPayloadArg]),
    ).toEqual([
      ["start", null, false],
      ["score", null, true],
    ]);
  });

  it("ignores call sites inside strings and comments", () => {
    const source = [
      '// CARTRIDGE.send("level", { index: 1 })',
      '/* CARTRIDGE.send("end", { reason: "win" }) */',
      'const doc = "CARTRIDGE.send(\\"level\\", {index: 2})";',
      'const tpl = `CARTRIDGE.send("level")`;',
    ].join("\n");
    expect(sites(source)).toEqual([]);
  });

  it("never mistakes canvas text for a level call site", () => {
    const source =
      'ctx.fillText("Level 2", x, y); ctx.fillText(`level ${n}`, 4, 4);';
    expect(sites(source)).toEqual([]);
  });

  it("reads nested objects, braces in strings and template values", () => {
    const source =
      'CARTRIDGE.send("boot", { title: "A {b}", meta: { deep: { x: 1 } }, gameType: `toy-box`, lang: `${l}` });';
    const payload = sites(source)[0]?.payload;
    expect([...(payload?.keys() ?? [])]).toEqual([
      "title",
      "meta",
      "gameType",
      "lang",
    ]);
    expect(payload?.get("title")).toEqual({ kind: "string", value: "A {b}" });
    expect(payload?.get("gameType")).toEqual({
      kind: "string",
      value: "toy-box",
    });
    expect(payload?.get("lang")?.kind).toBe("expression");
  });

  it("reads shorthand, quoted keys and spreads", () => {
    const payload = sites(
      'CARTRIDGE.send("boot", { title, "lang": "en", ...rest, gameType: t });',
    )[0]?.payload;
    expect([...(payload?.keys() ?? [])]).toEqual(["title", "lang", "gameType"]);
    expect(payload?.get("lang")).toEqual({ kind: "string", value: "en" });
  });

  it("skips calls whose event name is not a static literal", () => {
    expect(sites("CARTRIDGE.send(kind, {}); CARTRIDGE.send(`e${n}`);")).toEqual(
      [],
    );
  });

  it("tolerates an unterminated payload", () => {
    const [site] = sites('CARTRIDGE.send("score", { value: 1');
    expect(site?.event).toBe("score");
    expect(site?.payload).toBeNull();
  });
});
