import {
  type LayerController,
  initLayerStack,
} from "../components/layer-stack";
import {
  graphSurface,
  harnessSurface,
  requestSurface,
  toolsSurface,
  verifiersSurface,
} from "../components/plane-surfaces";
import { LAYERS, type LayerCopy } from "../content/layers";
import { FALLBACK_CATALOG } from "../data/fallback";
import { fullReport } from "../data/report";
import { fill, mount, richText } from "../lib/dom";
import { icon } from "../lib/icons";
import { stepStatus } from "../viewmodel/layers";
import { type CopyValues, copyValues } from "../viewmodel/values";

const INTRO =
  "Five layers, from the request at the bottom to the eval harness at the top. Step through them.";

/** Surface markup per plane. */
function surfaces(): Readonly<Record<string, string>> {
  return {
    "1": requestSurface(FALLBACK_CATALOG, fullReport),
    "2": graphSurface(),
    "3": toolsSurface(),
    "4": verifiersSurface(),
    "5": harnessSurface(fullReport),
  };
}

/** The problem and answer copy shared by the detail panel and the static list. */
function layerBody(layer: LayerCopy, values: CopyValues): string {
  const answers = layer.answer
    .map((line) => `<li>${richText(fill(line, values))}</li>`)
    .join("");
  const caveat =
    layer.caveat === null
      ? ""
      : `<p class="caveat">${richText(fill(layer.caveat, values))}</p>`;
  return `<h4>The problem</h4><p>${richText(layer.problem)}</p><h4>How cartridge answers it</h4><ul>${answers}</ul>${caveat}`;
}

/** The 3D planes, bottom to top. */
function planesMarkup(surfaceMap: Readonly<Record<string, string>>): string {
  return LAYERS.map(
    (layer) =>
      `<div class="plane" data-plane="${layer.step}"><span class="plane-tab"><span class="plane-tab__num">${layer.step}</span>${layer.name}</span>${surfaceMap[layer.step] ?? ""}</div>`,
  ).join("");
}

/** One step button that jumps straight to a state. */
function gotoButton(goto: string, label: string): string {
  return `<button type="button" class="button" data-goto="${goto}" aria-pressed="false">${label}</button>`;
}

/** A Previous / status / Next stepper, Collapse and Show all, then a segmented row of layer names. */
function controlsMarkup(): string {
  const names = LAYERS.map((layer) => gotoButton(layer.step, layer.name)).join(
    "",
  );
  return `<div class="step-controls" role="group" aria-label="Layer steps" data-step-group>
    <div class="stepper">
      <button type="button" class="button" data-offset="-1" aria-label="Previous layer">${icon("chevron-left")}</button>
      <p class="stepper__status" data-step-status>${stepStatus("collapsed")}</p>
      <button type="button" class="button" data-offset="1" aria-label="Next layer">${icon("chevron-right")}</button>
    </div>
    <div class="step-extra">${gotoButton("collapsed", "Collapse")}${gotoButton("overview", "Show all")}</div>
    <div class="step-names" role="group" aria-label="Go to a layer">${names}</div>
  </div>`;
}

/** Detail panels for every state; only the current one is visible. */
function detailMarkup(values: CopyValues): string {
  const layerPanels = LAYERS.map(
    (layer) => `<div class="layer-panel" data-panel="${layer.step}" hidden>
      <p class="layer-panel__index">Layer ${layer.step} of ${String(LAYERS.length)}</p>
      <h3>${richText(fill(layer.heading, values))}</h3>${layerBody(layer, values)}</div>`,
  ).join("");
  const overview = LAYERS.map(
    (layer) =>
      `<li><button type="button" class="button" data-goto="${layer.step}"><span>${layer.step} ${richText(fill(layer.heading, values))}</span></button></li>`,
  ).join("");
  return `<div class="layer-detail" role="region" aria-live="polite" aria-label="Layer details">
    <div class="layer-panel" data-panel="collapsed"><h3>The stack</h3><p>${INTRO}</p><p class="caveat">A request flows up: request, workflow graph, tools and cards, verifiers, eval harness.</p></div>
    ${layerPanels}
    <div class="layer-panel" data-panel="overview" hidden><h3>All ${String(LAYERS.length)} layers</h3><ol class="layer-panel__overview">${overview}</ol></div>
  </div>`;
}

/** The static fallback list, read from the request upwards. */
function listMarkup(
  surfaceMap: Readonly<Record<string, string>>,
  values: CopyValues,
): string {
  const items = LAYERS.map(
    (layer) => `<li class="layers-list__item">
      <div class="layers-list__figure">${surfaceMap[layer.step] ?? ""}</div>
      <div class="layer-panel"><p class="layer-panel__index">Layer ${layer.step} of ${String(LAYERS.length)}</p><h3>${richText(fill(layer.heading, values))}</h3>${layerBody(layer, values)}</div>
    </li>`,
  ).join("");
  return `<ol class="container layers-list" aria-label="The five layers, from the request at the bottom of the stack to the eval harness at the top">${items}</ol>`;
}

/** Section 2: the interactive layer stack plus its static fallback. */
export function renderLayers(): LayerController {
  const values = copyValues(fullReport);
  const surfaceMap = surfaces();
  const section = mount(
    "layers",
    `<div class="container section-head">
      <h2 id="layers-title">How it is built</h2>
      <p class="lede">${INTRO} Each layer pairs a problem with how cartridge answers it.</p>
    </div>
    <div class="layers-track" data-layers-track>
      <div class="container layers-stage" id="layers-stage">
        ${controlsMarkup()}
        ${detailMarkup(values)}
        <div class="stack-viewport" aria-hidden="true"><div class="stack-scene">${planesMarkup(surfaceMap)}</div></div>
      </div>
    </div>
    ${listMarkup(surfaceMap, values)}`,
  );
  return initLayerStack(section);
}
