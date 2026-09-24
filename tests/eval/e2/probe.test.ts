import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DETECTORS, toE2Result } from "../../../src/eval/e2/detectors.ts";
import { loadGame, probeGame } from "../../../src/eval/e2/probe.ts";
import { PROBE_VIEWPORT } from "../../../src/eval/e2/thresholds.ts";
import { E2Result } from "../../../src/eval/e2/types.ts";
import { REPO_ROOT } from "../../../src/eval/matrix.ts";

const BROWSER_BUDGET_MS = 120_000;
const THROW_SETTLE_MS = 500;
const SMALL_BOT = { trials: 1, trialMaxSeconds: 2 };

const goodArcade = readFileSync(
  join(REPO_ROOT, "fixtures", "good", "good-arcade-run.html"),
  "utf8",
);

const THROWER = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8"></head>',
  "<body><script>",
  "setTimeout(() => { null.width; }, 50);",
  'setTimeout(() => { Promise.reject(new Error("lost tile")); }, 60);',
  'setTimeout(() => { console.error("sprite sheet", 3); }, 70);',
  "</script></body></html>",
].join("\n");

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, BROWSER_BUDGET_MS);

afterAll(async () => {
  await browser.close();
});

describe("E2 probe harness (§8.1)", () => {
  it("renders the instrumented game in standards mode inside a sandboxed frame", async () => {
    const page = await browser.newPage({ viewport: PROBE_VIEWPORT });
    const frame = await loadGame(page, goodArcade);
    expect(await frame.evaluate("document.compatMode")).toBe("CSS1Compat");
    const sandbox = await page.evaluate(
      'document.querySelector("iframe").getAttribute("sandbox")',
    );
    expect(sandbox).toBe("allow-scripts");
    await page.close();
  });

  it("forwards errors, rejections and console.error; pageerror also sees the first two (Playwright 1.63)", async () => {
    const page = await browser.newPage({ viewport: PROBE_VIEWPORT });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await loadGame(page, THROWER);
    await page.waitForTimeout(THROW_SETTLE_MS);
    const forwarded = await page.evaluate<string[]>(
      "window.__probe.errors.map((entry) => entry.kind)",
    );
    expect(forwarded.sort()).toEqual([
      "console.error",
      "error",
      "unhandledrejection",
    ]);
    expect(pageErrors).toHaveLength(2);
    await page.close();
  });

  it(
    "probes a good game end to end and reports longestPlaySeconds without gating on it",
    async () => {
      const observation = await probeGame(browser, goodArcade, {
        id: "good-arcade-run",
        bot: SMALL_BOT,
      });
      const result = E2Result.parse(toE2Result(observation, DETECTORS));
      expect(
        Object.values(result.detectors).every((verdict) => verdict !== "fail"),
      ).toBe(true);
      expect(typeof result.longestPlaySeconds).toBe("number");
      expect(result.consoleErrors).toEqual([]);
    },
    BROWSER_BUDGET_MS,
  );
});
