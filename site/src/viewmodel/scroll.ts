/**
 * Progress through a scroll track in [0, 1]: 0 while its top is at or below the viewport top,
 * 1 once its bottom reaches the viewport bottom.
 */
export function trackProgress(
  top: number,
  height: number,
  viewportHeight: number,
): number {
  const scrollable = height - viewportHeight;
  if (scrollable <= 0) return 0;
  return Math.min(Math.max(-top / scrollable, 0), 1);
}

/** Whether a horizontally scrolling region actually overflows, so its scroll hint is true. */
export function needsScrollHint(
  scrollWidth: number,
  clientWidth: number,
): boolean {
  return scrollWidth > clientWidth;
}
