import {
  type ReplayController,
  initReplay,
} from "../components/replay-controller";
import { replayShellMarkup } from "../components/replay-panel";
import { REPLAY_BANNER, REPLAY_CHIP } from "../content/run";
import { FALLBACK_CATALOG } from "../data/fallback";
import { fullReport } from "../data/report";
import { esc, mount } from "../lib/dom";
import { icon } from "../lib/icons";
import { type CatalogEntry, parseCatalog } from "../viewmodel/catalog";

const PROMPTS_URL = "/api/prompts";

/** Keep only entries the committed report knows, so every pick has an E2 result to show. */
function knownEntries(entries: readonly CatalogEntry[]): CatalogEntry[] {
  const ids = new Set(fullReport.items.map((item) => item.id));
  return entries.filter((entry) => ids.has(entry.id));
}

/** Load the live prompt list; on any failure, keep the bundled copy and say so. */
async function loadCatalog(controller: ReplayController): Promise<void> {
  try {
    const response = await fetch(PROMPTS_URL, {
      headers: { accept: "application/json" },
    });
    const parsed = response.ok
      ? parseCatalog((await response.json()) as unknown)
      : null;
    const entries = parsed === null ? [] : knownEntries(parsed);
    if (entries.length === 0) throw new Error("empty or invalid prompt list");
    controller.setCatalog(entries, "api");
  } catch {
    controller.setCatalog(FALLBACK_CATALOG, "bundled");
  }
}

/** Section 4: pick a recorded prompt and replay it through the real engine. */
export function renderRun(): ReplayController {
  const first = FALLBACK_CATALOG[0];
  if (first === undefined) throw new Error("The bundled catalog is empty");
  const section = mount(
    "run",
    `<div class="container section-head">
      <p class="label-badge label-badge--signal">${esc(REPLAY_CHIP)}</p>
      <h2 id="run-title">Run it</h2>
      <p class="lede">Pick one of the ${String(FALLBACK_CATALOG.length)} recorded prompts. The server runs the workflow graph, the E1 verifier, the repair loop and the run lifecycle for this request, and streams every event to this page over SSE.</p>
      <p class="banner">${icon("info")}<span>${esc(REPLAY_BANNER)}</span></p>
    </div>
    <div class="container run" data-run-root>${replayShellMarkup(FALLBACK_CATALOG, first.id)}</div>`,
  );
  const root = section.querySelector<HTMLElement>("[data-run-root]");
  if (root === null) throw new Error("Missing replay root");
  const controller = initReplay(root, FALLBACK_CATALOG);
  void loadCatalog(controller);
  return controller;
}
