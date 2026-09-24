import { closestTarget, prefersReducedMotion } from "../lib/dom";
import {
  type LayerStep,
  activePlaneIndex,
  parseLayerStep,
  stepForScrollProgress,
  stepOffset,
  stepStatus,
  transitionFor,
} from "../viewmodel/layers";
import { trackProgress } from "../viewmodel/scroll";

/** Where a step change came from; a capture request pins the state against scrolling. */
export type StepSource = "button" | "key" | "scroll" | "query" | "capture";

/** Imperative handle for the layer stack. */
export interface LayerController {
  setStep(step: LayerStep, source: StepSource): void;
  readonly step: () => LayerStep;
}

const SCROLL_QUERY =
  "(min-width: 80rem) and (min-height: 47rem) and (prefers-reduced-motion: no-preference)";
const KEY_DELTAS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};

interface StackState {
  step: LayerStep;
  pinned: boolean;
  scrollBand: LayerStep | null;
}

/** Whether the browser can draw the 3D stack at all. */
function canEnhance(): boolean {
  const forced = window.matchMedia("(forced-colors: active)").matches;
  return CSS.supports("transform-style", "preserve-3d") && !forced;
}

/** Reflect a step on the stepper status and the pressed state of the step buttons. */
function renderControls(section: HTMLElement, step: LayerStep): void {
  const status = section.querySelector("[data-step-status]");
  if (status !== null) status.textContent = stepStatus(step);
  section
    .querySelectorAll<HTMLElement>(".layers-stage [data-goto]")
    .forEach((button) => {
      if (button.closest(".layer-panel") === null)
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.goto === step),
        );
    });
}

/** Reflect a step on planes, controls and detail panels. */
function render(
  section: HTMLElement,
  previous: LayerStep,
  step: LayerStep,
): void {
  section.dataset.transition = transitionFor(previous, step);
  section.dataset.step = step;
  const active = activePlaneIndex(step);
  section.querySelectorAll<HTMLElement>(".plane").forEach((plane, index) => {
    plane.classList.toggle("is-active", index === active);
  });
  renderControls(section, step);
  section
    .querySelectorAll<HTMLElement>(".layer-detail > [data-panel]")
    .forEach((panel) => {
      panel.hidden = panel.dataset.panel !== step;
    });
}

/** The initial step from `?layers=`, defaulting to collapsed. */
function initialStep(): LayerStep {
  const requested = new URLSearchParams(window.location.search).get("layers");
  return parseLayerStep(requested) ?? "collapsed";
}

/** Button clicks and arrow keys inside the step group. */
function bindControls(section: HTMLElement, controller: LayerController): void {
  section.addEventListener("click", (event) => {
    const goto = parseLayerStep(
      closestTarget(event, "[data-goto]")?.dataset.goto,
    );
    if (goto !== null) return controller.setStep(goto, "button");
    const offset = closestTarget(event, "[data-offset]")?.dataset.offset;
    if (offset !== undefined)
      controller.setStep(
        stepOffset(controller.step(), Number(offset)),
        "button",
      );
  });
  section
    .querySelector("[data-step-group]")
    ?.addEventListener("keydown", (event) => {
      const delta =
        event instanceof KeyboardEvent ? KEY_DELTAS[event.key] : undefined;
      if (delta === undefined) return;
      event.preventDefault();
      controller.setStep(stepOffset(controller.step(), delta), "key");
    });
}

/** The step band for the track's current scroll position. */
function scrollBand(track: HTMLElement): LayerStep {
  const box = track.getBoundingClientRect();
  return stepForScrollProgress(
    trackProgress(box.top, box.height, window.innerHeight),
  );
}

/** Run a handler at most once per animation frame while the window scrolls. */
function onScrollFrame(handler: () => void): void {
  let queued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        handler();
      });
    },
    { passive: true },
  );
}

/** On wide screens, scrolling through the track steps the stack when the scroll band changes. */
function bindScroll(
  section: HTMLElement,
  state: StackState,
  controller: LayerController,
): void {
  const track = section.querySelector<HTMLElement>("[data-layers-track]");
  const media = window.matchMedia(SCROLL_QUERY);
  if (track === null) return;
  const sync = (): void => {
    section.toggleAttribute("data-scroll-driven", media.matches);
    state.scrollBand = scrollBand(track);
  };
  sync();
  media.addEventListener("change", sync);
  onScrollFrame(() => {
    if (!media.matches || state.pinned) return;
    const band = scrollBand(track);
    if (band === state.scrollBand) return;
    state.scrollBand = band;
    controller.setStep(band, "scroll");
  });
}

/** Upgrade the static layer list into the step-driven 3D stack. */
export function initLayerStack(section: HTMLElement): LayerController {
  const state: StackState = {
    step: initialStep(),
    pinned: false,
    scrollBand: null,
  };
  const controller: LayerController = {
    /** Apply a step; capture and query requests pin it so scrolling cannot override it. */
    setStep(step: LayerStep, source: StepSource): void {
      if (source === "capture" || source === "query") state.pinned = true;
      const previous = state.step;
      state.step = step;
      render(section, previous, step);
    },
    step: () => state.step,
  };
  if (canEnhance()) section.toggleAttribute("data-enhanced", true);
  section.toggleAttribute("data-reduced-motion", prefersReducedMotion());
  render(section, state.step, state.step);
  if (state.step !== "collapsed") state.pinned = true;
  bindControls(section, controller);
  bindScroll(section, state, controller);
  return controller;
}
