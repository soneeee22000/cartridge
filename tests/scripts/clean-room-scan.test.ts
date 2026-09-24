import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLEAN_ROOM_DENYLIST_SHA256,
  hashTerm,
  scanText,
  tokenHashes,
} from "../../scripts/clean-room-scan.ts";

const PROBE_TERM = "zebrafinch lantern";
const PROBE_TOKEN = "marmalade";

function tempRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "cartridge-clean-room-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(root, name), text);
  return root;
}

function runScan(args: string[]): number | null {
  return spawnSync(process.execPath, ["scripts/clean-room-scan.ts", ...args], {
    encoding: "utf8",
  }).status;
}

describe("clean-room scan (§12.3)", () => {
  it("hashes normalised terms, single tokens and adjacent pairs", () => {
    expect(hashTerm("  Zebrafinch   LANTERN ")).toBe(hashTerm(PROBE_TERM));
    const hashes = tokenHashes("a zebrafinch, lantern!");
    expect(hashes.has(hashTerm("zebrafinch"))).toBe(true);
    expect(hashes.has(hashTerm(PROBE_TERM))).toBe(true);
  });

  it("finds denylisted terms in text", () => {
    const deny = new Set([hashTerm(PROBE_TOKEN)]);
    expect(scanText("orange Marmalade jar", deny)).toEqual([
      hashTerm(PROBE_TOKEN),
    ]);
    expect(scanText("orange jam", deny)).toEqual([]);
  });

  it("ships digests only", () => {
    for (const digest of CLEAN_ROOM_DENYLIST_SHA256)
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("exits 0 on this tree", () => {
    expect(runScan([])).toBe(0);
  });

  it("exits 1 on an untracked file that contains a denylisted term", () => {
    const clean = tempRepo({ "notes.md": "orange jam" });
    expect(runScan(["--root", clean, "--deny", hashTerm(PROBE_TOKEN)])).toBe(0);
    const dirty = tempRepo({ "notes.md": `orange ${PROBE_TOKEN}` });
    expect(runScan(["--root", dirty, "--deny", hashTerm(PROBE_TOKEN)])).toBe(1);
    const pair = tempRepo({ "notes.md": "a zebrafinch-lantern sketch" });
    expect(runScan(["--root", pair, "--deny", hashTerm(PROBE_TERM)])).toBe(1);
  });

  it("prints digests with --hash", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/clean-room-scan.ts", "--hash", PROBE_TOKEN],
      {
        encoding: "utf8",
      },
    );
    expect(result.stdout.trim()).toBe(hashTerm(PROBE_TOKEN));
  });
});
