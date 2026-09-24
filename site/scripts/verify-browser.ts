import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Browser, type Page, chromium } from "playwright";

const DEFAULT_URL = "http://localhost:4281/";
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;
const DEFAULT_TIMEOUT_MS = 240_000;
const MAX_TABS = 80;
const AA_TEXT = 4.5;
const REPAIRED_ITEM = "bubble-pop";

/** Token pairs whose text contrast must meet WCAG AA on this page. */
const CONTRAST_PAIRS: readonly (readonly [string, string])[] = [
  ["--c-ink", "--c-ground"],
  ["--c-ink-muted", "--c-ground"],
  ["--c-ink-muted", "--c-raised"],
  ["--c-ink-muted", "--c-sunken"],
  ["--c-signal", "--c-ground"],
  ["--c-signal", "--c-sunken"],
  ["--c-pass", "--c-ground"],
  ["--c-pass", "--c-raised"],
  ["--c-trip", "--c-ground"],
  ["--c-trip", "--c-raised"],
  ["--c-trip", "--c-trip-wash"],
  ["--c-ink", "--c-signal-wash"],
  ["--c-ground", "--c-signal"],
];

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Open the page at a viewport, collecting console errors, and wait for the ready flag. */
async function open(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
  reducedMotion: "reduce" | "no-preference",
): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const context = await browser.newContext({
    viewport,
    reducedMotion,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
  );
  return { page, errors, close: () => context.close() };
}

/** Whether the page scrolls sideways. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

/** Tab from the top until the prompt picker has focus, and read its focus outline. */
async function keyboardToPicker(page: Page): Promise<Check> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
  });
  for (let tab = 0; tab < MAX_TABS; tab += 1) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => document.activeElement?.id ?? "");
    if (id !== "prompt-picker") continue;
    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element);
      return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`;
    });
    const ok = !outline.startsWith("none");
    return {
      name: "keyboard reaches the picker with a visible focus ring",
      ok,
      detail: `${String(tab + 1)} tabs, outline ${outline}`,
    };
  }
  return {
    name: "keyboard reaches the picker with a visible focus ring",
    ok: false,
    detail: `not reached in ${String(MAX_TABS)} tabs`,
  };
}

/** Run the repaired item's replay and check the repair step, the terminal score and the game. */
async function replayRepaired(page: Page, timeoutMs: number): Promise<Check[]> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __bridge: string[] }).__bridge = seen;
    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data as { source?: unknown; type?: unknown } | null;
      if (data?.source === "cartridge" && typeof data.type === "string")
        seen.push(data.type);
    });
  });
  await page.selectOption("#prompt-picker", REPAIRED_ITEM);
  await page.click("[data-run]");
  await page.waitForFunction(
    () =>
      window.__replayPhase?.() !== "connecting" &&
      window.__replayPhase?.() !== "streaming" &&
      window.__replayPhase?.() !== "reconnecting",
    undefined,
    { timeout: timeoutMs },
  );
  const phase = await page.evaluate(() => window.__replayPhase?.() ?? "");
  const repairNode = await page
    .locator(
      '#run .graph-svg--wide [data-node="repair"], #run .graph-svg--narrow [data-node="repair"]',
    )
    .first()
    .getAttribute("class");
  const log = await page.locator("[data-log]").innerText();
  const score = await page.locator("[data-score]").innerText();
  const sandbox = await page
    .locator("[data-frame] iframe")
    .getAttribute("sandbox");
  await page
    .waitForFunction(
      () =>
        (
          (window as unknown as { __bridge?: string[] }).__bridge ?? []
        ).includes("boot"),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  const bridge = await page.evaluate(
    () => (window as unknown as { __bridge?: string[] }).__bridge ?? [],
  );
  return [
    { name: "replay completes", ok: phase === "complete", detail: phase },
    {
      name: "repair node lit and repair event logged",
      ok:
        (repairNode ?? "").includes("gnode--done") &&
        log.includes("repair from E1-24"),
      detail: repairNode ?? "none",
    },
    { name: "terminal E1 score shown", ok: score === "1.000", detail: score },
    {
      name: "iframe sandbox is allow-scripts only",
      ok: sandbox === "allow-scripts",
      detail: String(sandbox),
    },
    {
      name: "game boots inside the iframe (bridge messages)",
      ok: bridge.includes("boot"),
      detail: bridge.join(","),
    },
  ];
}

/** Compute WCAG contrast ratios for the token pairs, resolving colour-mix values in the browser. */
async function contrast(page: Page): Promise<Check[]> {
  const ratios = await page.evaluate((pairs) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const probe = document.createElement("span");
    document.body.append(probe);
    const rgb = (token: string): number[] => {
      probe.style.color = `var(${token})`;
      const resolved = getComputedStyle(probe).color;
      if (context === null) return [0, 0, 0];
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = resolved;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const luminance = (channels: number[]): number => {
      const [r = 0, g = 0, b = 0] = channels.map((value) => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const result = pairs.map(([fore, back]) => {
      const a = luminance(rgb(fore));
      const b = luminance(rgb(back));
      return [
        fore,
        back,
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      ] as const;
    });
    probe.remove();
    return result;
  }, CONTRAST_PAIRS);
  return ratios.map(([fore, back, ratio]) => ({
    name: `contrast ${fore} on ${back}`,
    ok: ratio >= AA_TEXT,
    detail: ratio.toFixed(2),
  }));
}

/** With reduced motion, the pulse and smooth scrolling must be off. */
async function reducedMotion(browser: Browser, url: string): Promise<Check> {
  const session = await open(browser, url, VIEWPORTS[1], "reduce");
  const result = await session.page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "gnode gnode--active";
    probe.innerHTML = '<svg><rect class="gnode__box"/></svg>';
    document.body.append(probe);
    const box = probe.querySelector("rect");
    const animation = box === null ? "" : getComputedStyle(box).animationName;
    const scroll = getComputedStyle(document.documentElement).scrollBehavior;
    const duration = getComputedStyle(document.documentElement)
      .getPropertyValue("--dur-move")
      .trim();
    probe.remove();
    return { animation, scroll, duration };
  });
  await session.close();
  const ok =
    result.animation === "none" &&
    result.scroll === "auto" &&
    (result.duration === "0ms" || result.duration === "0s");
  return {
    name: "reduced motion disables the pulse, smooth scroll and transitions",
    ok,
    detail: JSON.stringify(result),
  };
}

/** Every check for one viewport. */
async function checkViewport(
  browser: Browser,
  url: string,
  viewport: (typeof VIEWPORTS)[number],
  outDir: string,
  timeoutMs: number,
): Promise<Check[]> {
  const session = await open(browser, url, viewport, "no-preference");
  const { page } = session;
  const checks: Check[] = [];
  checks.push({
    name: "no horizontal scroll at load",
    ok: (await horizontalOverflow(page)) <= 0,
    detail: `${String(await horizontalOverflow(page))} px`,
  });
  checks.push(await keyboardToPicker(page));
  await page.screenshot({ path: join(outDir, `${viewport.name}-top.png`) });
  checks.push(...(await replayRepaired(page, timeoutMs)));
  checks.push({
    name: "no horizontal scroll after the replay",
    ok: (await horizontalOverflow(page)) <= 0,
    detail: `${String(await horizontalOverflow(page))} px`,
  });
  await page
    .locator("#run")
    .screenshot({ path: join(outDir, `${viewport.name}-run.png`) });
  await page.screenshot({
    path: join(outDir, `${viewport.name}-full.png`),
    fullPage: true,
  });
  if (viewport.name === "desktop") checks.push(...(await contrast(page)));
  await session.close();
  checks.push({
    name: "no console errors",
    ok: session.errors.length === 0,
    detail: session.errors.join(" | ") || "none",
  });
  return checks;
}

/** Run every check in real Chromium and exit non-zero if any fails. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      out: { type: "string" },
      timeout: { type: "string" },
    },
  });
  const url = values.url ?? DEFAULT_URL;
  const outDir = values.out ?? join(tmpdir(), "cartridge-verify");
  const timeoutMs = Number(values.timeout ?? DEFAULT_TIMEOUT_MS);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const viewport of VIEWPORTS) {
      for (const check of await checkViewport(
        browser,
        url,
        viewport,
        outDir,
        timeoutMs,
      )) {
        if (!check.ok) failed += 1;
        console.log(
          `${check.ok ? "PASS" : "FAIL"} [${viewport.name}] ${check.name}: ${check.detail}`,
        );
      }
    }
    const motion = await reducedMotion(browser, url);
    if (!motion.ok) failed += 1;
    console.log(
      `${motion.ok ? "PASS" : "FAIL"} ${motion.name}: ${motion.detail}`,
    );
  } finally {
    await browser.close();
  }
  console.log(`screenshots in ${outDir}`);
  if (failed > 0) throw new Error(`${String(failed)} browser checks failed`);
}

await main();
