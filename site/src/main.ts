import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/martian-mono/wdth.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/svg.css";
import "./styles/sections.css";
import "./styles/layers.css";
import "./styles/run.css";
import "./styles/eval.css";
import type { LayerController } from "./components/layer-stack";
import type { ReplayController } from "./components/replay-controller";
import { bindScrollHints } from "./lib/scroll-hint";
import { initTooltip } from "./lib/tooltip";
import { renderBackend } from "./sections/backend";
import { renderEvaluation } from "./sections/evaluation";
import { renderFooter } from "./sections/footer";
import { renderGraph } from "./sections/graph";
import { renderHero } from "./sections/hero";
import { renderLayers } from "./sections/layers";
import { renderLimits } from "./sections/limits";
import { renderRun } from "./sections/run";
import { renderWhy } from "./sections/why";
import { parseLayerStep } from "./viewmodel/layers";

/** Deterministic hooks for the capture script; they only set state, they never time anything. */
function exposeCaptureHooks(
  layers: LayerController,
  replay: ReplayController,
): void {
  window.__setLayerStep = (step: number | string): string | null => {
    const parsed = parseLayerStep(step);
    if (parsed !== null) layers.setStep(parsed, "capture");
    return parsed;
  };
  window.__replayFrameCount = (): number => replay.frameCount();
  window.__setReplayFrame = (count: number): number => replay.showFrame(count);
  window.__replayPhase = (): string => replay.state().phase;
}

/** Render every section in page order, then wire shared behaviour. */
function boot(): void {
  renderHero();
  const layers = renderLayers();
  renderWhy();
  const replay = renderRun();
  renderGraph();
  renderEvaluation();
  renderBackend();
  renderLimits();
  renderFooter();
  bindScrollHints(document);
  initTooltip();
  exposeCaptureHooks(layers, replay);
  void document.fonts.ready.then(() => {
    document.documentElement.dataset.ready = "true";
  });
}

boot();
