import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MEDIA_CONTRACT, verifyMedia } from "./contract";

const MEDIA_DIR = fileURLToPath(
  new URL("../../../docs/media/", import.meta.url),
);

describe("media contract", () => {
  it("lists each capture once", () => {
    const files = MEDIA_CONTRACT.map((spec) => spec.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it("holds for the committed docs/media folder", () => {
    expect(verifyMedia(MEDIA_DIR)).toEqual([]);
  });
});
