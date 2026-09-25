import { query } from "../lib/dom";
import {
  type Disconnect,
  type ReplayPace,
  openReplay,
} from "../lib/replay-source";
import type { CatalogEntry, CatalogSource } from "../viewmodel/catalog";
import {
  INITIAL_REPLAY_STATE,
  type ReplayAction,
  type ReplayState,
  isRunning,
  reduceReplay,
} from "../viewmodel/replay-state";
import { elapsedSeconds, frameTitle } from "../viewmodel/run-view";
import {
  optionsMarkup,
  renderReplayState,
  renderSelection,
} from "./replay-panel";

const TICK_MS = 1000;
const FRAME_SANDBOX = "allow-scripts";

/** Imperative handle for the replay panel. */
export interface ReplayController {
  run(promptId: string, pace?: ReplayPace): void;
  stop(): void;
  setCatalog(catalog: readonly CatalogEntry[], source: CatalogSource): void;
  /** Capture hook: draw the state after the first `count` received messages; returns the count drawn. */
  showFrame(count: number): number;
  /** How many messages the current run has received. */
  frameCount(): number;
  state(): ReplayState;
}

interface Panel {
  readonly root: HTMLElement;
  readonly picker: HTMLSelectElement;
  current: ReplayState;
  received: ReplayAction[];
  disconnect: Disconnect | null;
  startedAt: number;
  timer: number | null;
  frameSha: string | null;
  catalog: readonly CatalogEntry[];
}

/** Replace the game frame with a fresh sandboxed iframe holding the game, or the empty note. */
function showGame(panel: Panel, state: ReplayState): void {
  const frame = query(panel.root, "[data-frame]", HTMLElement);
  const artifact = state.terminal?.artifact ?? null;
  const sha = artifact?.sha256 ?? null;
  if (sha === panel.frameSha) return;
  panel.frameSha = sha;
  frame.querySelector("iframe")?.remove();
  query(frame, "[data-frame-empty]", HTMLElement).hidden = artifact !== null;
  if (artifact === null) return;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", FRAME_SANDBOX);
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.title = frameTitle(state);
  iframe.className = "game-frame__iframe";
  iframe.srcdoc = artifact.html;
  frame.prepend(iframe);
}

/** Update the elapsed counter. */
function tick(panel: Panel): void {
  const elapsed = query(panel.root, "[data-elapsed]", HTMLElement);
  elapsed.textContent =
    panel.current.phase === "idle"
      ? ""
      : `${String(elapsedSeconds(panel.startedAt, performance.now()))} s since the request`;
}

/** Enable the buttons for the current phase and keep the elapsed counter ticking while running. */
function syncControls(panel: Panel): void {
  const running = isRunning(panel.current);
  const stopButton = query(panel.root, "[data-stop]", HTMLButtonElement);
  if (!running && document.activeElement === stopButton)
    query(panel.root, "[data-run]", HTMLButtonElement).focus();
  stopButton.disabled = !running;
  query(panel.root, "[data-run-label]", HTMLElement).textContent = running
    ? "Restart the replay"
    : "Run the replay";
  if (running && panel.timer === null)
    panel.timer = window.setInterval(() => {
      tick(panel);
    }, TICK_MS);
  if (!running && panel.timer !== null) {
    window.clearInterval(panel.timer);
    panel.timer = null;
  }
  tick(panel);
}

/** Draw one state: graph, log, score and the game. */
function draw(panel: Panel, state: ReplayState): void {
  renderReplayState(panel.root, state);
  showGame(panel, state);
}

/** Reduce one action into the current state and redraw. */
function apply(panel: Panel, action: ReplayAction): void {
  panel.current = reduceReplay(panel.current, action);
  draw(panel, panel.current);
  syncControls(panel);
}

/** Close the open connection, if any; later messages from it are dropped. */
function disconnect(panel: Panel): void {
  panel.disconnect?.();
  panel.disconnect = null;
}

/** The speed picked in the form, fast-forward unless recorded pace is checked. */
function pickedPace(panel: Panel): ReplayPace {
  const checked = panel.root.querySelector<HTMLInputElement>(
    'input[name="pace"]:checked',
  );
  return checked?.value === "recorded" ? "recorded" : "fast";
}

/** Start a replay, closing any previous one first. */
function run(panel: Panel, promptId: string, pace: ReplayPace): void {
  disconnect(panel);
  panel.received = [];
  panel.startedAt = performance.now();
  apply(panel, { type: "start", promptId });
  let open = true;
  const close = openReplay(promptId, pace, (action) => {
    if (!open) return;
    panel.received.push(action);
    apply(panel, action);
  });
  panel.disconnect = () => {
    open = false;
    close();
  };
}

/** Stop the running replay; closing the connection aborts the run on the server. */
function stop(panel: Panel): void {
  if (!isRunning(panel.current)) return;
  disconnect(panel);
  apply(panel, { type: "stopped" });
}

/** Stop anything running and clear the board for a new pick. */
function reset(panel: Panel): void {
  disconnect(panel);
  panel.received = [];
  panel.current = INITIAL_REPLAY_STATE;
  draw(panel, panel.current);
  syncControls(panel);
}

/** The entry the picker currently shows. */
function selected(panel: Panel): CatalogEntry | undefined {
  return panel.catalog.find((entry) => entry.id === panel.picker.value);
}

/** Swap in a new catalog, keeping the current pick when it still exists. */
function setCatalog(
  panel: Panel,
  catalog: readonly CatalogEntry[],
  source: CatalogSource,
): void {
  panel.catalog = catalog;
  panel.picker.innerHTML = optionsMarkup(catalog, panel.picker.value);
  query(panel.root, "[data-fallback]", HTMLElement).hidden = source === "api";
  renderSelection(panel.root, selected(panel));
}

/** Draw the state after the first `count` received messages, for the capture script. */
function showFrame(panel: Panel, count: number): number {
  const clamped = Math.min(
    Math.max(Math.floor(count), 0),
    panel.received.length,
  );
  const start: ReplayAction = {
    type: "start",
    promptId: panel.current.promptId ?? "",
  };
  const state = [start, ...panel.received.slice(0, clamped)].reduce(
    reduceReplay,
    INITIAL_REPLAY_STATE,
  );
  draw(panel, state);
  return clamped;
}

/** Form submit runs the selected prompt, Stop stops, and a new pick resets the board. */
function bindControls(panel: Panel): void {
  query(panel.root, "[data-run-form]", HTMLFormElement).addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      run(panel, panel.picker.value, pickedPace(panel));
    },
  );
  query(panel.root, "[data-stop]", HTMLButtonElement).addEventListener(
    "click",
    () => {
      stop(panel);
    },
  );
  panel.picker.addEventListener("change", () => {
    reset(panel);
    renderSelection(panel.root, selected(panel));
  });
}

/**
 * Wire the replay panel: the picker, the run and stop buttons, and one `EventSource` at a time.
 * Picking another prompt or pressing Run again closes the previous connection first, and messages
 * from a closed connection are ignored.
 */
export function initReplay(
  root: HTMLElement,
  catalog: readonly CatalogEntry[],
): ReplayController {
  const panel: Panel = {
    root,
    picker: query(root, "[data-picker]", HTMLSelectElement),
    current: INITIAL_REPLAY_STATE,
    received: [],
    disconnect: null,
    startedAt: 0,
    timer: null,
    frameSha: null,
    catalog,
  };
  bindControls(panel);
  renderSelection(root, selected(panel));
  reset(panel);
  return {
    run: (promptId, pace) => {
      run(panel, promptId, pace ?? pickedPace(panel));
    },
    stop: () => {
      stop(panel);
    },
    setCatalog: (next, source) => {
      setCatalog(panel, next, source);
    },
    showFrame: (count) => showFrame(panel, count),
    frameCount: () => panel.received.length,
    state: () => panel.current,
  };
}
