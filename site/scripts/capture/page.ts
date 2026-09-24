import type { Browser, BrowserContext, Page } from "playwright";

/** A viewport size in CSS pixels. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** An open page plus the console errors it has reported so far. */
export interface PageSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly errors: string[];
}

/** A vertical page region spanning from one element's top to another's bottom. */
export interface Region {
  readonly top: string;
  readonly bottom: string;
}

interface RegionBox {
  readonly top: number;
  readonly bottom: number;
  readonly topbar: number;
}

const DEVICE_SCALE = 1;
const TOPBAR_SELECTOR = ".topbar";

/** Open a fresh context at a fixed viewport and wait for the page's own ready flag and fonts. */
export async function openPage(
  browser: Browser,
  url: string,
  viewport: Viewport,
): Promise<PageSession> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: DEVICE_SCALE,
    reducedMotion: "no-preference",
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
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return { context, page, errors };
}

/** Close a session, failing the run if the page logged any error. */
export async function closePage(
  session: PageSession,
  label: string,
): Promise<void> {
  await session.context.close();
  if (session.errors.length > 0) {
    throw new Error(`${label}: console errors: ${session.errors.join(" | ")}`);
  }
}

/** Jump the window to a scroll offset, bypassing the page's smooth-scroll rule. */
export async function scrollToY(page: Page, top: number): Promise<void> {
  await page.evaluate((target) => {
    window.scrollTo({ top: target, behavior: "instant" });
  }, top);
}

/** Absolute page offset of an element's top edge. */
export async function elementTop(
  page: Page,
  selector: string,
): Promise<number> {
  return page
    .locator(selector)
    .evaluate(
      (element) => element.getBoundingClientRect().top + window.scrollY,
    );
}

/** Height of the sticky top bar, which covers the top of every viewport. */
export async function topbarHeight(page: Page): Promise<number> {
  return page
    .locator(TOPBAR_SELECTOR)
    .evaluate((element) => element.getBoundingClientRect().height);
}

/** Jump every finite transition or animation to its end state. */
export async function finishTransitions(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end === "number" && Number.isFinite(end)) animation.finish();
    }
  });
}

/** Pause every finite transition at its start and return the longest end time in ms. */
export async function pauseTransitions(page: Page): Promise<number> {
  return page.evaluate(() => {
    let longest = 0;
    for (const animation of document.getAnimations()) {
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end !== "number" || !Number.isFinite(end)) continue;
      animation.pause();
      animation.currentTime = 0;
      longest = Math.max(longest, end);
    }
    return longest;
  });
}

/** Seek every paused transition to the same timeline position in ms. */
export async function seekTransitions(page: Page, time: number): Promise<void> {
  await page.evaluate((position) => {
    for (const animation of document.getAnimations()) {
      if (animation.playState === "paused") animation.currentTime = position;
    }
  }, time);
}

/** Page offsets of a region's top and bottom, plus the top bar height. */
async function measureRegion(page: Page, region: Region): Promise<RegionBox> {
  const top = await elementTop(page, region.top);
  const bottom = await page
    .locator(region.bottom)
    .evaluate(
      (element) => element.getBoundingClientRect().bottom + window.scrollY,
    );
  return { top, bottom, topbar: await topbarHeight(page) };
}

/** Screenshot a full-width page region below the sticky top bar, growing the viewport when needed. */
export async function captureRegion(
  session: PageSession,
  region: Region,
  path: string,
  padding: number,
): Promise<void> {
  const { page } = session;
  const base = page.viewportSize();
  if (base === null) throw new Error("Viewport size is not fixed");
  const first = await measureRegion(page, region);
  const needed = Math.ceil(
    first.bottom - first.top + padding * 2 + first.topbar,
  );
  if (needed > base.height)
    await page.setViewportSize({ width: base.width, height: needed });
  const box = await measureRegion(page, region);
  await scrollToY(page, box.top - padding - box.topbar);
  await finishTransitions(page);
  const clipTop = (await page.locator(region.top).boundingBox())?.y ?? 0;
  const clip = {
    x: 0,
    y: clipTop - padding,
    width: base.width,
    height: Math.ceil(box.bottom - box.top + padding * 2),
  };
  await page.screenshot({ path, clip, animations: "disabled" });
  await page.setViewportSize(base);
}
