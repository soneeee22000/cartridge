import { PAID_RUNS_NOTE, repoFile } from "../content/links";
import { WHY_BLOCKS, WHY_CAVEAT } from "../content/why";
import { fullReport } from "../data/report";
import { code, fill, mount, richText } from "../lib/dom";
import { icon } from "../lib/icons";
import { runtimeFailures } from "../viewmodel/results";
import { copyValues } from "../viewmodel/values";

/** One statically perfect game that failed at runtime, with the detectors it tripped. */
function failureRow(
  failure: ReturnType<typeof runtimeFailures>[number],
): string {
  const detectors = failure.detectors
    .map(
      (detector) =>
        `<span class="chip chip--trip">${icon("circle-x")}${detector}</span>`,
    )
    .join("");
  return `<li class="gap-list__item"><span class="gap-list__id">${code(failure.id)}</span><span class="gap-list__meta">${failure.gameType}, ${failure.band}</span><span class="gap-list__chips">${detectors}</span></li>`;
}

/** Section 3: static checks are necessary, not sufficient. */
export function renderWhy(): void {
  const values = copyValues(fullReport);
  const blocks = WHY_BLOCKS.map(
    (block) =>
      `<div class="why__block"><h3>${block.heading}</h3>${block.paragraphs.map((paragraph) => `<p>${richText(fill(paragraph, values))}</p>`).join("")}</div>`,
  ).join("");
  const failures = runtimeFailures(fullReport);
  const caveat = fill(WHY_CAVEAT, { notes: repoFile(PAID_RUNS_NOTE) });
  mount(
    "why",
    `<div class="container why">
      <div class="why__head"><h2 id="why-title">Static checks are necessary, not sufficient</h2></div>
      <div class="why__blocks">${blocks}
        <figure class="gap-figure">
          <figcaption><h3>The ${String(failures.length)} games with E1 ${String(values.score)} that failed E2</h3></figcaption>
          <ul class="gap-list">${failures.map(failureRow).join("")}</ul>
          <p class="caveat">${richText(caveat)}</p>
        </figure>
      </div>
    </div>`,
  );
}
