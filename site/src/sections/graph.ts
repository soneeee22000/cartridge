import { workflowGraphMarkup } from "../components/workflow-graph";
import { ADRS, repoFile } from "../content/links";
import { FALLBACK_CATALOG } from "../data/fallback";
import { fullReport } from "../data/report";
import { code, esc, mount } from "../lib/dom";
import { icon } from "../lib/icons";
import { repairTriggers } from "../viewmodel/evaluation";
import { formatScore } from "../viewmodel/format";
import type { ReplayState } from "../viewmodel/replay-state";
import { repairedItem } from "../viewmodel/results";

/** The E1 rule whose recorded repair this section traces. */
export const TRACE_RULE = "E1-24";

/** What E1-24 checks, from SPEC §2.3. */
const TRACE_RULE_TEXT =
  "toy-box only: the game handles the reset command and an in-game control element calls the same reset function.";

/** The graph state of a recorded run that repaired once and then finalized. */
function tracedView(): Pick<ReplayState, "nodes" | "edges"> {
  return {
    nodes: {
      plan: "done",
      generate: "done",
      verify: "done",
      repair: "done",
      finalize: "done",
      reject: "idle",
    },
    edges: [
      "plan>generate",
      "generate>verify",
      "verify>repair",
      "repair>generate",
      "verify>finalize",
    ],
  };
}

const TRACED_ATTEMPTS = 2;

/** The trace steps of the recorded repair, all from full.json. */
function traceSteps(): string {
  const item = repairedItem(fullReport, TRACE_RULE);
  if (item.buildAttempts !== TRACED_ATTEMPTS)
    throw new Error("The trace copy describes exactly one repair");
  const rules = item.repairRules.map((rule) => code(rule)).join(", ");
  const score = item.e1Score === null ? "n/a" : formatScore(item.e1Score);
  const steps = [
    `${code("plan")} picks ${code(item.gameType ?? "none")} for the ${esc(item.lang)} prompt.`,
    `${code("generate")} writes build attempt 0 through ${code("save_draft")}.`,
    `${code("verify")} runs E1: hard rule ${rules} fails, so the graph routes to ${code("repair")}.`,
    `${code("generate")} writes build attempt 1 with the rule's fix hint in its prompt.`,
    `${code("verify")} passes (E1 ${score}), so the graph takes ${code("finalize")}. Build attempts: ${String(item.buildAttempts)}.`,
  ];
  return steps.map((step) => `<li>${step}</li>`).join("");
}

/** Section 5: the static graph with one recorded repair traced through it. */
export function renderGraph(): void {
  const item = repairedItem(fullReport, TRACE_RULE);
  const prompt =
    FALLBACK_CATALOG.find((entry) => entry.id === item.id)?.prompt ?? "";
  const triggers = repairTriggers(fullReport)
    .map((trigger) => `${code(trigger.rule)} ×${String(trigger.count)}`)
    .join(", ");
  const adr = ADRS[0];
  mount(
    "graph",
    `<div class="container">
      <div class="section-head">
        <h2 id="graph-title">The orchestration graph</h2>
        <p class="lede">The run is an explicit workflow, not a model deciding what to do next. Verification is a node the graph always visits, and the repair loop is an edge with a cap. ${adr === undefined ? "" : `<a href="${repoFile(adr.path)}">${esc(adr.id)}</a> records why.`}</p>
      </div>
      <div class="graph-trace">
        <figure class="graph-trace__figure">${workflowGraphMarkup(tracedView())}<figcaption class="muted">The path of the recorded run of ${code(item.id)}: one repair, then finalize.</figcaption></figure>
        <div class="graph-trace__text">
          <h3>A recorded repair: ${code(item.id)}</h3>
          <blockquote class="run__prompt">${esc(prompt)}</blockquote>
          <ol class="trace-steps">${traceSteps()}</ol>
          <p class="caveat">${icon("info")} ${code(TRACE_RULE)} checks: ${esc(TRACE_RULE_TEXT)} Across the full run, repairs were triggered by ${triggers}.</p>
        </div>
      </div>
    </div>`,
  );
}
