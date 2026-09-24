import { ENGINE_CONSTANTS } from "../content/engine";
import { PACE_NOTE, PHASE_TEXT } from "../content/run";
import type { ReportItem } from "../types/report";
import { fill } from "../lib/dom";
import { formatScore, formatSeconds } from "./format";
import type { ReplayState, VerdictEntry } from "./replay-state";

const MS_PER_SECOND = 1000;

/** The status line for a replay state. */
export function statusText(state: ReplayState): string {
  const base = PHASE_TEXT[state.phase];
  return state.error === null ? base : `${base} ${state.error}`;
}

/** One verdict as a short line, e.g. `Attempt 0: E1 0.952, failed E1-24`. */
export function verdictLine(verdict: VerdictEntry): string {
  const head = `Attempt ${String(verdict.buildAttempt)}: E1 ${formatScore(verdict.score)}`;
  if (verdict.ok) return `${head}, passed`;
  return `${head}, failed ${verdict.errors.join(", ")}`;
}

/** The E1 score from the terminal event, formatted, or null before it arrives. */
export function terminalScore(state: ReplayState): string | null {
  const score = state.terminal?.e1Score;
  return score === undefined || score === null ? null : formatScore(score);
}

/** How the replay is paced, with the item's own recorded wall time from full.json. */
export function paceNote(item: ReportItem | null): string {
  const recorded =
    item?.wallMs === null || item?.wallMs === undefined
      ? "not recorded"
      : formatSeconds(item.wallMs);
  return fill(PACE_NOTE, {
    gapSeconds: ENGINE_CONSTANTS.REPLAY_MAX_GAP_MS / MS_PER_SECOND,
    recordedSeconds: recorded,
  });
}

/** Whole seconds since a start time, for the elapsed counter. */
export function elapsedSeconds(startedAt: number, now: number): number {
  return Math.max(Math.floor((now - startedAt) / MS_PER_SECOND), 0);
}

/** The accessible name of the game frame. */
export function frameTitle(state: ReplayState): string {
  const title = state.spec?.title ?? "";
  const id = state.promptId ?? "";
  return title === ""
    ? `Game generated for ${id}`
    : `Game generated for ${id}: ${title}`;
}
