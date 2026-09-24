import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** sha256 of each denylisted term (lowercased, tokenised, space-joined). The terms are never committed. */
export const CLEAN_ROOM_DENYLIST_SHA256: readonly string[] = [
  "61ab6ef8539e8c084c33e9536c76bee51fcde97e5fee632ad51d115a6a65075c",
  "82793067e9172a1009f50502f56f2bb57b770c26942160a60febce5512814bf5",
  "7511319892cc0df3b9ef21e84fb9fd3830e3188e3e0b6f8cbc8992452b0b63a8",
  "9cc064529f2d9e3fd128e7ad00a08bc940e98e4d55e1943acdb2d557dd209252",
  "8073f83106a846fcf9903a09ec326ccfaa5c55681854e08635a02e71cfe8c69c",
  "7f7111f35fb92b2c814f7f127ed9c69780802f63d2a06ea051bfa819f34eacfe",
  "e7c6abb0f612da8238ef5d7b8e27200a4a8743a8961c5d8ec53e8e82543ee0c1",
  "e95ac1c28511c9205f0c05cffaa0c319b49ebdd222603bcfbd250163dc732ee6",
];

const TOKEN_PATTERN = /[a-z0-9]+/g;
const EXIT_CLEAN = 0;
const EXIT_HIT = 1;
const BINARY_MARKER = "\u0000";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function tokenise(text: string): string[] {
  return text.toLowerCase().match(TOKEN_PATTERN) ?? [];
}

/**
 * Hashes a term the way the scanner sees it: lowercased, tokenised on [a-z0-9]+, joined by one space.
 * @param term a word or phrase
 */
export function hashTerm(term: string): string {
  return sha256(tokenise(term).join(" "));
}

/**
 * Hashes every token and every pair of adjacent tokens in the text.
 * @param text file contents
 */
export function tokenHashes(text: string): Set<string> {
  const tokens = tokenise(text);
  const hashes = new Set<string>();
  tokens.forEach((token, index) => {
    hashes.add(sha256(token));
    const next = tokens[index + 1];
    if (next !== undefined) hashes.add(sha256(`${token} ${next}`));
  });
  return hashes;
}

/**
 * Returns the denylisted digests that occur in the text.
 * @param text file contents
 * @param denylist digests to look for
 */
export function scanText(
  text: string,
  denylist: ReadonlySet<string>,
): string[] {
  return [...tokenHashes(text)].filter((digest) => denylist.has(digest));
}

function listFiles(root: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  return output.split(BINARY_MARKER).filter((name) => name.length > 0);
}

function scanTree(
  root: string,
  denylist: ReadonlySet<string>,
): Array<{ file: string; digest: string }> {
  const hits: Array<{ file: string; digest: string }> = [];
  for (const file of listFiles(root)) {
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes(BINARY_MARKER)) continue;
    for (const digest of scanText(text, denylist)) hits.push({ file, digest });
  }
  return hits;
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      hash: { type: "boolean" },
      root: { type: "string" },
      deny: { type: "string", multiple: true },
    },
  });
  if (values.hash) {
    for (const term of positionals) process.stdout.write(`${hashTerm(term)}\n`);
    return EXIT_CLEAN;
  }
  const denylist = new Set([
    ...CLEAN_ROOM_DENYLIST_SHA256,
    ...(values.deny ?? []),
  ]);
  const hits = scanTree(values.root ?? process.cwd(), denylist);
  for (const hit of hits)
    process.stderr.write(
      `clean-room: ${hit.file} contains denylisted term ${hit.digest.slice(0, 12)}\n`,
    );
  if (hits.length === 0)
    process.stdout.write("clean-room: no denylisted terms found\n");
  return hits.length === 0 ? EXIT_CLEAN : EXIT_HIT;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = main(process.argv.slice(2));
}
