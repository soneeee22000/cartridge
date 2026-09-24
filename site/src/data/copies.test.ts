import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPORT_FILES = ["full.json", "sample.json", "matrix.json"] as const;
const COMMITTED_DIR = new URL("../../../reports/committed/", import.meta.url);
const SITE_DATA_DIR = new URL("./", import.meta.url);

/** The raw bytes of a file under a directory URL. */
function bytes(dir: URL, file: string): Buffer {
  return readFileSync(fileURLToPath(new URL(file, dir)));
}

describe("bundled report copies", () => {
  it.each(REPORT_FILES)("%s is byte-identical to reports/committed", (file) => {
    expect(bytes(SITE_DATA_DIR, file).equals(bytes(COMMITTED_DIR, file))).toBe(
      true,
    );
  });
});
