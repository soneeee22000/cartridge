import { CALIBRATION_NOTE, ADRS, repoFile } from "../content/links";
import { fullReport, matrix } from "../data/report";
import { code, esc, mount } from "../lib/dom";
import { icon } from "../lib/icons";
import {
  type MatrixRow,
  bandTable,
  barShare,
  detectorFailTable,
  languageCounts,
  matrixRows,
  matrixSummary,
  repairHistogram,
  repairTriggers,
} from "../viewmodel/evaluation";
import {
  formatCount,
  formatMinutes,
  formatScore,
  formatSeconds,
  formatTokens,
  formatUsd,
} from "../viewmodel/format";
import { BAND_ORDER } from "../viewmodel/results";

const PERCENT = 100;

/** Which models each usage role in the report covers. */
const ROLE_LABELS: Readonly<Record<string, { label: string; model: string }>> =
  {
    generator: { label: "planner and builder", model: "builder" },
    judge: { label: "E3 judge", model: "judge" },
  };

/** A table wrapped in a horizontal scroll region with a hint. */
function scrollTable(
  id: string,
  caption: string,
  head: string,
  body: string,
): string {
  return `<div class="table-scroll" id="${id}" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="data-table"><caption class="sr-only">${esc(caption)}</caption><thead>${head}</thead><tbody>${body}</tbody></table></div><p class="scroll-hint muted" data-scroll-region="${id}" hidden>Scroll sideways for more columns.</p>`;
}

/** One detection-matrix row. */
function matrixRowMarkup(row: MatrixRow): string {
  const fired =
    row.fired.length === 0 ? "none" : row.fired.map((id) => code(id)).join(" ");
  const tone =
    row.verdict === "caught" || row.verdict === "clean"
      ? "state--pass"
      : "state--trip";
  const expected =
    row.expected === null ? "none (control)" : code(row.expected);
  return `<tr><td>${esc(row.set)}</td><th scope="row">${code(row.fixture)}</th><td>${formatScore(row.e1Score)}</td><td>${expected}</td><td>${fired}</td><td><span class="state ${tone}">${esc(row.verdict)}</span></td></tr>`;
}

/** Block A: the detection matrix on hand-authored fixtures. */
function matrixBlock(): string {
  const summary = matrixSummary(matrix)
    .map((set) => {
      const controls =
        set.controls === 0
          ? ""
          : `, ${formatCount(set.clean, set.controls)} good controls clean`;
      return `<li><strong>${esc(set.set)}</strong>: ${formatCount(set.caught, set.knownBad)} known-bad fixtures caught${controls}</li>`;
    })
    .join("");
  const head =
    '<tr><th scope="col">Set</th><th scope="col">Fixture</th><th scope="col">E1</th><th scope="col">Built to trip</th><th scope="col">Fired</th><th scope="col">Verdict</th></tr>';
  const body = matrixRows(matrix).map(matrixRowMarkup).join("");
  return `<div class="eval-block" id="eval-matrix">
    <h3>Detection matrix</h3>
    <p>Every fixture scores E1 ${formatScore(Math.min(...matrixRows(matrix).map((row) => row.e1Score)))}. Each known-bad one is built to trip one E2 detector. The thresholds were tuned on the tuning set; the holdout set was written after they were frozen (<a href="${repoFile(CALIBRATION_NOTE)}">calibration note</a>).</p>
    <ul class="eval-summary">${summary}</ul>
    ${scrollTable("matrix-table", "Detection matrix verdicts", head, body)}
    <p class="caveat">Demonstrated on hand-authored fixtures, with thresholds tuned on the same tuning set. This shows each detector can catch the defect it was written for; it is not a detection rate.</p>
  </div>`;
}

/** Block B: per-band results, never averaged across bands. */
function bandsBlock(): string {
  const head =
    '<tr><th scope="col">Band</th><th scope="col">Items</th><th scope="col">Games</th><th scope="col">E1 min</th><th scope="col">E2 passed</th><th scope="col">Median build attempts</th><th scope="col">E4 match / mismatch / abstain</th></tr>';
  const body = bandTable(fullReport)
    .map(
      (row) =>
        `<tr><th scope="row">${esc(row.band)}</th><td>${String(row.n)}</td><td>${String(row.games)}</td><td>${row.e1Min === null ? "n/a" : formatScore(row.e1Min)}</td><td>${formatCount(row.e2Passed, row.e2Probed)}</td><td>${String(row.medianBuildAttempts ?? "n/a")}</td><td>${String(row.e4Match)} / ${String(row.e4Mismatch)} / ${String(row.e4Abstain)}</td></tr>`,
    )
    .join("");
  return `<div class="eval-block" id="eval-bands">
    <h3>Per length band</h3>
    <p>Each band is reported on its own. There is deliberately no row that averages across bands.</p>
    ${scrollTable("bands-table", "Results per length band", head, body)}
  </div>`;
}

/** Block C: E2 detector failures per band. */
function detectorBlock(): string {
  const bandHeads = BAND_ORDER.map(
    (band) => `<th scope="col">${esc(band)}</th>`,
  ).join("");
  const head = `<tr><th scope="col">Detector</th>${bandHeads}<th scope="col">Games failed</th></tr>`;
  const body = detectorFailTable(fullReport)
    .map(
      (row) =>
        `<tr><th scope="row">${code(row.detector)}</th>${row.perBand.map((count) => `<td>${String(count)}</td>`).join("")}<td>${String(row.total)}</td></tr>`,
    )
    .join("");
  return `<div class="eval-block" id="eval-detectors">
    <h3>E2 detector failures on the generated games</h3>
    <p>A game can fail more than one detector, so the column adds up to more than the number of failing games.</p>
    ${scrollTable("detectors-table", "E2 detector failures per band", head, body)}
  </div>`;
}

/** Block D: E4 language match. */
function languageBlock(): string {
  const counts = languageCounts(fullReport);
  const check = fullReport.e4Labelled;
  return `<div class="eval-block" id="eval-language">
    <h3>E4 language match</h3>
    <dl class="mini-stats">
      <div><dt>match</dt><dd>${String(counts.match)}</dd></div>
      <div><dt>mismatch</dt><dd>${String(counts.mismatch)}</dd></div>
      <div><dt>abstain</dt><dd>${String(counts.abstain)}</dd></div>
    </dl>
    <p class="caveat">E4 abstains below an evidence floor instead of guessing. Its accuracy on its own labelled set is ${formatScore(check.accuracy)}, ${esc(check.note)}.</p>
  </div>`;
}

/** Block E: build attempts and what triggered the repairs. */
function repairBlock(): string {
  const bars = repairHistogram(fullReport);
  const largest = Math.max(...bars.map((bar) => bar.items));
  const rows = bars
    .map(
      (bar) =>
        `<li class="hbar"><span class="hbar__label">${String(bar.attempts)} build attempt${bar.attempts === 1 ? "" : "s"}</span><span class="hbar__track"><span class="hbar__fill" style="inline-size: ${String(Math.round(barShare(bar.items, largest) * PERCENT))}%"></span></span><span class="hbar__value">${String(bar.items)} items</span></li>`,
    )
    .join("");
  const triggers = repairTriggers(fullReport)
    .map(
      (trigger) =>
        `<li>${code(trigger.rule)}: ${String(trigger.count)} repair${trigger.count === 1 ? "" : "s"}</li>`,
    )
    .join("");
  return `<div class="eval-block" id="eval-repairs">
    <h3>Repairs</h3>
    <ul class="hbars" aria-label="Items by number of build attempts">${rows}</ul>
    <p>What triggered each repair:</p>
    <ul class="eval-summary">${triggers}</ul>
  </div>`;
}

/** Block F: estimated cost and recorded wall time. */
function costBlock(): string {
  const cost = fullReport.cost;
  const roles = Object.entries(cost.tokens)
    .map(
      ([role, usage]) =>
        `<tr><th scope="row">${esc(ROLE_LABELS[role]?.label ?? role)} (${code(fullReport.header.models[ROLE_LABELS[role]?.model ?? role] ?? "")})</th><td>${formatTokens(usage.input)}</td><td>${formatTokens(usage.output)}</td><td>${formatTokens(usage.cacheRead)}</td></tr>`,
    )
    .join("");
  const head =
    '<tr><th scope="col">Role</th><th scope="col">Input tokens</th><th scope="col">Output tokens</th><th scope="col">Cache reads</th></tr>';
  const wall =
    cost.wallMsMedian === null ? "n/a" : formatSeconds(cost.wallMsMedian);
  return `<div class="eval-block" id="eval-cost">
    <h3>Cost and time</h3>
    <dl class="mini-stats">
      <div><dt>Estimated cost of the full run</dt><dd>${formatUsd(cost.estUsd)}</dd></div>
      <div><dt>Median generation time per item</dt><dd>${wall}</dd></div>
      <div><dt>Total generation time</dt><dd>${formatMinutes(cost.wallMsTotal)}</dd></div>
    </dl>
    <p class="caveat">Cost: ${esc(cost.usdLabel)} (price table ${esc(fullReport.header.priceTableVersion)}). Time: wall-clock time measured once during the recorded run, model latency included; one run, not a benchmark.</p>
    ${scrollTable("cost-table", "Token usage by role", head, roles)}
  </div>`;
}

/** Block G: what was not measured, and the noise floor, verbatim from the report. */
function scopeBlock(): string {
  const items = fullReport.notMeasured
    .map((item) => `<li>${esc(item)}</li>`)
    .join("");
  return `<div class="eval-block eval-block--wide" id="eval-scope">
    <h3>Not measured</h3>
    <ul class="not-measured">${items}</ul>
    <h3>Noise floor</h3>
    <p class="noise-floor">${icon("triangle-alert")}<span>${esc(fullReport.noiseFloor)}</span></p>
  </div>`;
}

/** Section 6: the evaluation, every number from reports/committed. */
export function renderEvaluation(): void {
  const adr = ADRS[1];
  mount(
    "evaluation",
    `<div class="container">
      <div class="section-head">
        <h2 id="evaluation-title">Evaluation</h2>
        <p class="lede">From the committed full-tier report: ${String(fullReport.totals.n)} items, one generation each, planner and builder ${code(fullReport.header.models.builder ?? "")}, judge ${code(fullReport.header.models.judge ?? "")}. ${adr === undefined ? "" : `<a href="${repoFile(adr.path)}">${esc(adr.id)}</a> explains the tiers.`}</p>
      </div>
      <div class="eval-grid">
        ${matrixBlock()}
        ${bandsBlock()}
        ${detectorBlock()}
        ${languageBlock()}
        ${repairBlock()}
        ${costBlock()}
        ${scopeBlock()}
      </div>
    </div>`,
  );
}
