import { needsScrollHint } from "../viewmodel/scroll";

const HINT_SELECTOR = "[data-scroll-region]";

/** Show a hint only while the region it describes overflows its box. */
function sync(hint: HTMLElement, region: HTMLElement): void {
  hint.hidden = !needsScrollHint(region.scrollWidth, region.clientWidth);
}

/** Watch the region and its content, since a table can outgrow a box that never resizes. */
function watch(hint: HTMLElement, region: HTMLElement): void {
  sync(hint, region);
  void document.fonts.ready.then(() => sync(hint, region));
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => sync(hint, region));
  observer.observe(region);
  const content = region.firstElementChild;
  if (content !== null) observer.observe(content);
}

/** Keep every scroll hint under a root honest, at load and whenever its region changes size. */
export function bindScrollHints(root: ParentNode): void {
  for (const hint of root.querySelectorAll<HTMLElement>(HINT_SELECTOR)) {
    const region = document.getElementById(hint.dataset.scrollRegion ?? "");
    if (region !== null) watch(hint, region);
  }
}
