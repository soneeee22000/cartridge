import {
  CASSETTE_RULES,
  LIFECYCLE,
  LIFECYCLE_RULES,
  RELAY_RULES,
} from "../content/backend";
import { ADRS, SPEC_PATH, repoFile } from "../content/links";
import { fullReport } from "../data/report";
import { code, esc, fill, mount, richText } from "../lib/dom";
import { type CopyValues, copyValues } from "../viewmodel/values";

const TERMINAL_STATUSES = new Set(["complete", "abandoned"]);

/** The lifecycle as an ordered row of states, terminal ones marked. */
function lifecycleMarkup(values: CopyValues): string {
  const steps = LIFECYCLE.map((step) => {
    const terminal = TERMINAL_STATUSES.has(step.status)
      ? " lifecycle__step--terminal"
      : "";
    return `<li class="lifecycle__step${terminal}"><span class="lifecycle__name">${code(step.status)}</span><span class="lifecycle__meaning">${richText(fill(step.meaning, values))}</span></li>`;
  }).join("");
  return `<ol class="lifecycle" aria-label="Run statuses in order">${steps}</ol>`;
}

/** A titled list of rules with placeholders filled. */
function rulesMarkup(
  title: string,
  rules: readonly string[],
  values: CopyValues,
): string {
  const items = rules
    .map((rule) => `<li>${richText(fill(rule, values))}</li>`)
    .join("");
  return `<div class="backend__block"><h3>${esc(title)}</h3><ul class="backend__rules">${items}</ul></div>`;
}

/** Section 7: the run lifecycle, the SSE relay and cassette replay. */
export function renderBackend(): void {
  const values = copyValues(fullReport);
  const adr = ADRS[2];
  mount(
    "backend",
    `<div class="container">
      <div class="section-head">
        <h2 id="backend-title">Back end</h2>
        <p class="lede">TypeScript on Node 24. A run is a row with its own state machine, and the page reads it through an SSE relay that can resume. The <a href="${repoFile(SPEC_PATH)}">build contract</a> has the details${adr === undefined ? "" : `, and <a href="${repoFile(adr.path)}">${esc(adr.id)}</a> covers the replay design`}.</p>
      </div>
      <div class="backend">
        <div class="backend__block backend__block--wide"><h3>Run lifecycle</h3>${lifecycleMarkup(values)}</div>
        ${rulesMarkup("Claims, leases and retries", LIFECYCLE_RULES, values)}
        ${rulesMarkup("SSE with resume", RELAY_RULES, values)}
        ${rulesMarkup("Cassette replay", CASSETTE_RULES, values)}
      </div>
    </div>`,
  );
}
