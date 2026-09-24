import { describe, expect, it } from "vitest";
import {
  INSTRUMENT_SCRIPT,
  instrumentGame,
} from "../../../src/eval/e2/instrument.ts";

const TAG = `<script>${INSTRUMENT_SCRIPT}</script>`;

describe("E2 instrumentation (§8.1)", () => {
  it("injects right after the opening head tag, keeping the doctype first", () => {
    const html =
      '<!doctype html>\n<html lang="en">\n<head>\n<title>x</title></head><body></body></html>';
    const result = instrumentGame(html);
    expect(result.startsWith("<!doctype html>")).toBe(true);
    expect(result).toContain(`<head>${TAG}\n<title>`);
  });

  it("handles a head tag with attributes and upper case", () => {
    const html =
      '<!DOCTYPE html><HTML lang="fr"><HEAD data-x="1"><body></body></HTML>';
    expect(instrumentGame(html)).toContain(`<HEAD data-x="1">${TAG}<body>`);
  });

  it("does not mistake a header element for head", () => {
    const html =
      '<!doctype html><html lang="en"><body><header></header></body></html>';
    const result = instrumentGame(html);
    expect(result).toContain(`<html lang="en">${TAG}<body>`);
    expect(result).toContain("<header></header>");
  });

  it("falls back to after the html tag when there is no head", () => {
    const html = '<!doctype html><html lang="en"><body>hi</body></html>';
    expect(instrumentGame(html)).toBe(
      `<!doctype html><html lang="en">${TAG}<body>hi</body></html>`,
    );
  });

  it("ignores a head tag inside a comment", () => {
    const html =
      '<!doctype html><!-- <head> --><html lang="en"><head></head></html>';
    expect(instrumentGame(html)).toContain(`<head>${TAG}</head>`);
    expect(instrumentGame(html)).toContain("<!-- <head> -->");
  });

  it("appends after the doctype when the page has neither tag", () => {
    expect(instrumentGame("<!doctype html><p>x</p>")).toBe(
      `<!doctype html>${TAG}<p>x</p>`,
    );
  });

  it("forwards errors, rejections and console.error to the host", () => {
    expect(INSTRUMENT_SCRIPT).toContain('"cartridge-probe"');
    expect(INSTRUMENT_SCRIPT).toContain('"unhandledrejection"');
    expect(INSTRUMENT_SCRIPT).toContain("console.error");
  });
});
