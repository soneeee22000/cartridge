import { E2_OFFLINE_LABEL, FALLBACK_NOTE, PACE_OPTIONS } from "../content/run";
import { reportItem } from "../data/report";
import { code, esc, query } from "../lib/dom";
import { type IconName, icon } from "../lib/icons";
import {
  type CatalogEntry,
  optionLabel,
  wasRepaired,
} from "../viewmodel/catalog";
import { type ShownVerdict, itemE2View } from "../viewmodel/item-e2";
import type { LogEntry, ReplayState } from "../viewmodel/replay-state";
import {
  paceNote,
  statusText,
  terminalScore,
  verdictLine,
} from "../viewmodel/run-view";
import { workflowGraphMarkup } from "./workflow-graph";

/** The icon and tone for each committed detector verdict. */
/** How close to the bottom the log must be for new lines to keep it scrolled down (arbitrary). */
const LOG_FOLLOW_SLACK_PX = 24;

const VERDICT_MARKS: Readonly<
  Record<ShownVerdict, { icon: IconName; tone: string }>
> = {
  pass: { icon: "circle-check", tone: "state--pass" },
  fail: { icon: "circle-x", tone: "state--trip" },
  "n/a": { icon: "circle-minus", tone: "state--muted" },
  "not measured": { icon: "circle-minus", tone: "state--muted" },
};

/** One `<option>` for a catalog entry. */
function optionMarkup(entry: CatalogEntry, selected: string): string {
  const flag = entry.id === selected ? " selected" : "";
  return `<option value="${esc(entry.id)}"${flag}>${esc(optionLabel(entry))}</option>`;
}

/** The picker's options, grouped by whether the recorded run repaired. */
export function optionsMarkup(
  catalog: readonly CatalogEntry[],
  selected: string,
): string {
  const group = (label: string, entries: readonly CatalogEntry[]): string =>
    entries.length === 0
      ? ""
      : `<optgroup label="${esc(label)}">${entries.map((entry) => optionMarkup(entry, selected)).join("")}</optgroup>`;
  return `${group("Repaired during the recorded run", catalog.filter(wasRepaired))}${group(
    "Passed on the first build",
    catalog.filter((entry) => !wasRepaired(entry)),
  )}`;
}

/** The committed E2 result for an item, labelled as offline. */
export function e2PanelMarkup(promptId: string): string {
  const view = itemE2View(reportItem(promptId));
  if (view === null)
    return `<p class="muted">No committed E2 result for ${code(promptId)}.</p>`;
  const rows = view.detectors
    .map((row) => {
      const mark = VERDICT_MARKS[row.verdict];
      return `<tr><th scope="row">${code(row.detector)}</th><td><span class="state ${mark.tone}">${icon(mark.icon)}${esc(row.verdict)}</span></td></tr>`;
    })
    .join("");
  const errors = view.consoleErrors
    .map(
      (error) =>
        `<li>${code(error.message)} <span class="muted">×${String(error.count)}</span></li>`,
    )
    .join("");
  const errorList =
    errors === ""
      ? ""
      : `<p class="e2-panel__sub">Console errors the probe saw</p><ul class="e2-panel__errors">${errors}</ul>`;
  const verdict = view.passed
    ? `<span class="state state--pass">${icon("circle-check")}passed every applicable detector</span>`
    : `<span class="state state--trip">${icon("circle-x")}failed at least one detector</span>`;
  return `<h3 class="e2-panel__title">E2 result for ${code(promptId)}</h3>
    <p class="e2-panel__label">${icon("info")}<span>${esc(E2_OFFLINE_LABEL)}</span></p>
    <p>${verdict}</p>
    <table class="data-table e2-panel__table"><caption class="sr-only">E2 detector verdicts for ${esc(promptId)}</caption><thead><tr><th scope="col">Detector</th><th scope="col">Verdict</th></tr></thead><tbody>${rows}</tbody></table>
    ${errorList}
    <p class="muted e2-panel__sub">Longest play by the seeded random-tap bot (reported only): ${String(view.longestPlaySeconds ?? "n/a")} s</p>`;
}

/** The speed radios; fast-forward is checked by default. */
function paceChoiceMarkup(): string {
  return PACE_OPTIONS.map(
    (option, index) =>
      `<label class="run__pace-option"><input type="radio" name="pace" value="${option.value}"${index === 0 ? " checked" : ""}><span>${esc(option.label)}</span></label>`,
  ).join("");
}

/** The Run section's static shell: picker, status, graph, log and result areas. */
export function replayShellMarkup(
  catalog: readonly CatalogEntry[],
  selected: string,
): string {
  return `<form class="run__controls" data-run-form>
      <div class="run__field">
        <label for="prompt-picker">Recorded prompt</label>
        <select id="prompt-picker" name="promptId" data-picker>${optionsMarkup(catalog, selected)}</select>
      </div>
      <fieldset class="run__pace-choice">
        <legend>Speed</legend>
        ${paceChoiceMarkup()}
      </fieldset>
      <div class="run__buttons">
        <button type="submit" class="button button--primary" data-run>${icon("play")}<span data-run-label>Run the replay</span></button>
        <button type="button" class="button" data-stop disabled>${icon("square")}Stop</button>
      </div>
      <blockquote class="run__prompt" data-prompt></blockquote>
      <p class="run__pace muted" data-pace></p>
      <p class="run__fallback" data-fallback hidden>${icon("triangle-alert")}<span>${esc(FALLBACK_NOTE)}</span></p>
    </form>
    <div class="run__status"><p role="status" aria-live="polite" data-status></p><p class="muted" data-elapsed aria-hidden="true"></p></div>
    <div class="run__board">
      <figure class="run__graph"><figcaption class="sr-only">Workflow graph for this run</figcaption><div data-graph></div></figure>
      <div class="run__facts">
        <p class="run__score"><span class="run__score-label">E1 score of the finished game</span><span class="run__score-value" data-score>–</span></p>
        <p class="run__spec" data-spec></p>
        <ol class="run__verdicts" data-verdicts aria-label="E1 verdicts per build attempt"></ol>
      </div>
    </div>
    <details class="run__log-box" open><summary>Event log</summary><ol class="event-log" data-log tabindex="0" aria-label="Events received from /api/replay"></ol></details>
    <div class="run__result">
      <figure class="game-frame" data-frame><div class="game-frame__empty" data-frame-empty>The game appears here when the run completes.</div><figcaption class="game-frame__caption muted">The game runs in a sandboxed iframe with scripts allowed and no same-origin access.</figcaption></figure>
      <aside class="e2-panel" data-e2 aria-label="Committed E2 result"></aside>
    </div>`;
}

/** One event-log line. */
function logLine(entry: LogEntry): string {
  const seq = entry.seq === null ? "·" : String(entry.seq);
  return `<li class="event-log__line event-log__line--${entry.tone}"><span class="event-log__seq">${seq}</span><span class="event-log__kind">${esc(entry.kind)}</span><span class="event-log__text">${esc(entry.text)}</span></li>`;
}

/** Draw everything that depends only on the replay state. */
export function renderReplayState(root: HTMLElement, state: ReplayState): void {
  root.dataset.phase = state.phase;
  const status = query(root, "[data-status]", HTMLElement);
  const text = statusText(state);
  if (status.textContent !== text) status.textContent = text;
  query(root, "[data-graph]", HTMLElement).innerHTML =
    workflowGraphMarkup(state);
  query(root, "[data-score]", HTMLElement).textContent =
    terminalScore(state) ?? "–";
  const spec = state.spec;
  query(root, "[data-spec]", HTMLElement).innerHTML =
    spec === null
      ? ""
      : `Plan: ${code(spec.gameType)} ${code(spec.input)} ${code(spec.style)} ${code(spec.lang)} <span class="muted">(language from the ${esc(spec.langSource)})</span>`;
  query(root, "[data-verdicts]", HTMLElement).innerHTML = state.verdicts
    .map(
      (verdict) =>
        `<li class="state ${verdict.ok ? "state--pass" : "state--trip"}">${icon(verdict.ok ? "circle-check" : "circle-x")}${esc(verdictLine(verdict))}</li>`,
    )
    .join("");
  const log = query(root, "[data-log]", HTMLElement);
  const following =
    log.scrollHeight - log.scrollTop - log.clientHeight <= LOG_FOLLOW_SLACK_PX;
  log.innerHTML = state.log.map(logLine).join("");
  if (following) log.scrollTop = log.scrollHeight;
}

/** Show the prompt text, pace note and committed E2 result for the selected item. */
export function renderSelection(
  root: HTMLElement,
  entry: CatalogEntry | undefined,
): void {
  if (entry === undefined) return;
  query(root, "[data-prompt]", HTMLElement).textContent = entry.prompt;
  query(root, "[data-pace]", HTMLElement).textContent = paceNote(
    reportItem(entry.id),
  );
  query(root, "[data-e2]", HTMLElement).innerHTML = e2PanelMarkup(entry.id);
}
