import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/eval/cli.ts";
import { Verdict } from "../../src/eval/e1/score.ts";
import { game } from "./e1/fixtures.ts";

function writeGame(html: string, name = "game.html"): string {
  const dir = mkdtempSync(join(tmpdir(), "cartridge-cli-"));
  const file = join(dir, name);
  writeFileSync(file, html);
  return file;
}

function capture(argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = runCli(argv, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

describe("cli score (§12.2)", () => {
  it("prints a verdict for one file", () => {
    const { code, out } = capture(["score", "--file", writeGame(game())]);
    expect(code).toBe(0);
    const printed = JSON.parse(out) as { verdict: unknown };
    expect(Verdict.parse(printed.verdict).ok).toBe(true);
  });

  it("scores against a spec file when given", () => {
    const spec = writeGame(
      JSON.stringify({
        title: "Kite Rush",
        slug: "kite-rush",
        lang: "en",
        gameType: "puzzle-board",
        loop: "Fold kites.",
        input: "tap-anywhere",
        style: "chalkboard",
      }),
      "spec.json",
    );
    const { out } = capture([
      "score",
      "--file",
      writeGame(game()),
      "--spec",
      spec,
    ]);
    const printed = JSON.parse(out) as { verdict: Verdict };
    expect(printed.verdict.errors.map((finding) => finding.ruleId)).toContain(
      "E1-14",
    );
  });

  it("rejects unknown commands and a missing file", () => {
    expect(capture(["judge"]).code).toBe(2);
    expect(capture(["score"]).code).toBe(2);
    expect(
      capture(["score", "--file", join(tmpdir(), "no-such-game.html")]).code,
    ).toBe(2);
  });

  it("runs under plain node", () => {
    const result = spawnSync(
      process.execPath,
      ["src/eval/cli.ts", "score", "--file", writeGame(game())],
      {
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"verdict"');
  });
});
