import { REPO_URL } from "../content/links";
import { REPLAY_CHIP } from "../content/run";
import { fullReport } from "../data/report";
import { esc, mount } from "../lib/dom";
import { icon } from "../lib/icons";
import { formatCount, formatScore, formatUsd } from "../viewmodel/format";
import { headlineFacts } from "../viewmodel/results";

/** The clean-room line, verbatim from the SPEC and the README's first line. */
export const CLEAN_ROOM_LINE =
  "Independent reimplementation. Contains no client code, prompts, data or assets.";

/** One headline fact: a big value and what it counts. */
interface Fact {
  readonly value: string;
  readonly label: string;
  readonly tone: "pass" | "trip" | "plain";
}

/** The four facts, each computed from full.json. */
function facts(): Fact[] {
  const figures = headlineFacts(fullReport);
  return [
    {
      value: formatCount(figures.games, figures.items),
      label: "prompts produced a game",
      tone: "plain",
    },
    {
      value: formatScore(figures.e1Min),
      label: `E1 static score on all ${String(figures.e1Perfect)} games`,
      tone: "pass",
    },
    {
      value: formatCount(figures.e2Passed, figures.e2Probed),
      label: "passed the E2 runtime probe",
      tone: "trip",
    },
    {
      value: formatUsd(figures.estUsd),
      label: `estimated cost of the full run (${figures.usdLabel})`,
      tone: "plain",
    },
  ];
}

/** The facts as a description list. */
function factsMarkup(): string {
  const items = facts()
    .map(
      (fact) =>
        `<div class="fact fact--${fact.tone}"><dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd></div>`,
    )
    .join("");
  return `<dl class="facts" aria-label="Results of the committed full run">${items}</dl>`;
}

/** Section 1: name, one-liner, clean-room line, headline facts and the way in. */
export function renderHero(): void {
  const figures = headlineFacts(fullReport);
  if (figures.e1Perfect !== figures.items)
    throw new Error("Hero copy assumes a perfect E1 score on every item");
  mount(
    "hero",
    `<div class="container hero">
      <div class="hero__text">
        <p class="clean-room">${esc(CLEAN_ROOM_LINE)}</p>
        <h1 id="hero-title">cartridge</h1>
        <p class="hero__tagline">An agentic generator of single-file HTML5 mini-games, built as an explicit workflow graph and checked by a two-tier evaluator: free static rules first, then a headless runtime probe.</p>
        <p class="data-note">${icon("info")}<span>Figures come from the committed report of one full run over ${String(fullReport.totals.n)} authored prompts. The replay below runs the real engine with recorded model calls.</span></p>
        <div class="hero__actions">
          <a class="button button--primary" href="#run">${icon("play")}${esc(REPLAY_CHIP)}</a>
          <a class="button" href="${REPO_URL}">Read the source</a>
        </div>
      </div>
      <div class="hero__facts">${factsMarkup()}<p class="hero__gap">Every game passed every static rule; ${String(figures.staticPerfectRuntimeFail)} of them still failed at runtime. <a href="#why">Why that matters</a></p></div>
    </div>`,
  );
}
