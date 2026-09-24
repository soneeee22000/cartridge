/** Every state of the layer stack, in stepping order. */
export const LAYER_STEPS = [
  "collapsed",
  "1",
  "2",
  "3",
  "4",
  "5",
  "overview",
] as const;

/** One state of the layer stack. */
export type LayerStep = (typeof LAYER_STEPS)[number];

/** Number of planes in the stack. */
export const PLANE_COUNT = 5;

/** Parse a step from capture or query input: 0..6, "1".."5", "collapsed" or "overview". */
export function parseLayerStep(value: unknown): LayerStep | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? (LAYER_STEPS[value] ?? null) : null;
  }
  if (typeof value !== "string") return null;
  return LAYER_STEPS.find((step) => step === value) ?? null;
}

/** Move forward or back by `delta` steps, clamped at both ends. */
export function stepOffset(step: LayerStep, delta: number): LayerStep {
  const target = Math.min(
    Math.max(LAYER_STEPS.indexOf(step) + delta, 0),
    LAYER_STEPS.length - 1,
  );
  return LAYER_STEPS[target] ?? step;
}

/** Zero-based plane index that is active for a step, or null for collapsed and overview. */
export function activePlaneIndex(step: LayerStep): number | null {
  const position = LAYER_STEPS.indexOf(step);
  return position >= 1 && position <= PLANE_COUNT ? position - 1 : null;
}

/** The stepper's short status text for a step. */
export function stepStatus(step: LayerStep): string {
  if (step === "collapsed") return "Stacked";
  if (step === "overview") return `All ${PLANE_COUNT} layers`;
  return `Layer ${step} of ${PLANE_COUNT}`;
}

/** Map scroll progress through the section onto seven equal bands. */
export function stepForScrollProgress(progress: number): LayerStep {
  const bounded = Number.isNaN(progress)
    ? 0
    : Math.min(Math.max(progress, 0), 1);
  const band = Math.min(
    Math.floor(bounded * LAYER_STEPS.length),
    LAYER_STEPS.length - 1,
  );
  return LAYER_STEPS[band] ?? "collapsed";
}

/** How planes move between two states: staggered explode or collapse, a plain shift, or nothing. */
export type LayerTransition = "explode" | "collapse" | "shift" | "none";

/** Pick the transition style for moving from one step to another. */
export function transitionFor(
  previous: LayerStep,
  next: LayerStep,
): LayerTransition {
  if (previous === next) return "none";
  if (next === "collapsed") return "collapse";
  return previous === "collapsed" ? "explode" : "shift";
}
