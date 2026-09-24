/** Nodes of the drawn workflow graph (SPEC §4.1): the build cycle is split into its two phases. */
export const GRAPH_NODES = [
  "plan",
  "generate",
  "verify",
  "repair",
  "finalize",
  "reject",
] as const;

/** One node of the workflow graph. */
export type GraphNode = (typeof GRAPH_NODES)[number];

/** Directed edges of the graph, as `from>to`. */
export const GRAPH_EDGES = [
  "plan>generate",
  "generate>verify",
  "verify>repair",
  "repair>generate",
  "verify>finalize",
  "verify>reject",
] as const;

/** One edge of the workflow graph. */
export type GraphEdge = (typeof GRAPH_EDGES)[number];

/** What a node is doing right now. */
export type NodeStatus = "idle" | "active" | "done" | "failed";

/** Where the replay connection is. */
export type RunPhase =
  | "idle"
  | "connecting"
  | "streaming"
  | "reconnecting"
  | "complete"
  | "abandoned"
  | "stopped"
  | "error";

/** One E1 verdict from the build cycle's verify phase. */
export interface VerdictEntry {
  readonly buildAttempt: number;
  readonly ok: boolean;
  readonly score: number;
  readonly errors: readonly string[];
}

/** One repair pass and the rule ids that triggered it. */
export interface RepairEntry {
  readonly buildAttempt: number;
  readonly fromRules: readonly string[];
}

/** The planner's structured spec, reduced to what the page shows. */
export interface SpecSummary {
  readonly title: string;
  readonly gameType: string;
  readonly input: string;
  readonly style: string;
  readonly lang: string;
  readonly langSource: string;
}

/** Colour role of a log line. */
export type LogTone = "plain" | "pass" | "trip" | "signal";

/** One line of the event log. */
export interface LogEntry {
  readonly seq: number | null;
  readonly kind: string;
  readonly text: string;
  readonly tone: LogTone;
}

/** The game the run produced, from the terminal event. */
export interface ArtifactView {
  readonly version: string;
  readonly sha256: string;
  readonly html: string;
}

/** The terminal event, built on the server from the run row only. */
export interface TerminalView {
  readonly status: "complete" | "abandoned";
  readonly e1Score: number | null;
  readonly artifact: ArtifactView | null;
  readonly attribution: string | null;
}

/** Everything the replay panel draws, derived only from received events. */
export interface ReplayState {
  readonly promptId: string | null;
  readonly phase: RunPhase;
  readonly nodes: Readonly<Record<GraphNode, NodeStatus>>;
  readonly edges: readonly GraphEdge[];
  readonly buildAttempt: number;
  readonly verdicts: readonly VerdictEntry[];
  readonly repairs: readonly RepairEntry[];
  readonly spec: SpecSummary | null;
  readonly log: readonly LogEntry[];
  readonly lastSeq: number;
  readonly terminal: TerminalView | null;
  readonly error: string | null;
}

/** Inputs to the reducer: the page's own intents and the SSE messages it receives. */
export type ReplayAction =
  | { readonly type: "start"; readonly promptId: string }
  | { readonly type: "progress"; readonly seq: number; readonly data: string }
  | { readonly type: "terminal"; readonly seq: number; readonly data: string }
  | { readonly type: "reconnect" }
  | { readonly type: "connection-lost" }
  | { readonly type: "stopped" }
  | { readonly type: "failed"; readonly message: string };

const SCORE_DECIMALS = 3;

type Payload = Readonly<Record<string, unknown>>;
type Handler = (state: ReplayState, data: Payload) => ReplayState;

const IDLE_NODES: Readonly<Record<GraphNode, NodeStatus>> = {
  plan: "idle",
  generate: "idle",
  verify: "idle",
  repair: "idle",
  finalize: "idle",
  reject: "idle",
};

/** The state before any replay has started. */
export const INITIAL_REPLAY_STATE: ReplayState = {
  promptId: null,
  phase: "idle",
  nodes: IDLE_NODES,
  edges: [],
  buildAttempt: 0,
  verdicts: [],
  repairs: [],
  spec: null,
  log: [],
  lastSeq: 0,
  terminal: null,
  error: null,
};

/** A plain object from JSON, or null. */
function asPayload(value: unknown): Payload | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Payload)
    : null;
}

/** Parse a JSON data line into an object, or null when it is not one. */
export function parsePayload(data: string): Payload | null {
  try {
    return asPayload(JSON.parse(data) as unknown);
  } catch {
    return null;
  }
}

/** A string field, or a fallback. */
export function textField(data: Payload, key: string, fallback = ""): string {
  const value = data[key];
  return typeof value === "string" ? value : fallback;
}

/** A finite number field, or a fallback. */
export function numberField(data: Payload, key: string, fallback = 0): number {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A string-array field; anything that is not a string is dropped. */
export function listField(data: Payload, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Set some node statuses. */
function withNodes(
  state: ReplayState,
  changes: Partial<Record<GraphNode, NodeStatus>>,
): ReplayState {
  return { ...state, nodes: { ...state.nodes, ...changes } };
}

/** Mark an edge as traversed, once. */
function withEdge(state: ReplayState, edge: GraphEdge): ReplayState {
  if (state.edges.includes(edge)) return state;
  return { ...state, edges: [...state.edges, edge] };
}

/** `step.start`: the top-level steps plan, finalize and reject light their own node. */
function stepStart(state: ReplayState, data: Payload): ReplayState {
  const step = textField(data, "step");
  if (step === "plan") return withNodes(state, { plan: "active" });
  if (step === "finalize")
    return withEdge(
      withNodes(state, { finalize: "active" }),
      "verify>finalize",
    );
  if (step === "reject")
    return withEdge(withNodes(state, { reject: "active" }), "verify>reject");
  return state;
}

/** `step.result`: plan and finalize end done on success; reject always ends failed. */
function stepResult(state: ReplayState, data: Payload): ReplayState {
  const step = textField(data, "step");
  const ok = textField(data, "status") === "success";
  if (step === "plan")
    return withNodes(state, { plan: ok ? "done" : "failed" });
  if (step === "finalize")
    return withNodes(state, { finalize: ok ? "done" : "failed" });
  if (step === "reject") return withNodes(state, { reject: "failed" });
  return state;
}

/** `phase.start`: generate re-enters from plan on attempt 0 and from repair afterwards. */
function phaseStart(state: ReplayState, data: Payload): ReplayState {
  const buildAttempt = numberField(data, "buildAttempt");
  if (textField(data, "phase") === "verify")
    return withEdge(
      withNodes(state, { generate: "done", verify: "active" }),
      "generate>verify",
    );
  const next = { ...state, buildAttempt };
  if (buildAttempt === 0)
    return withEdge(withNodes(next, { generate: "active" }), "plan>generate");
  return withEdge(
    withNodes(next, { generate: "active", verify: "idle", repair: "done" }),
    "repair>generate",
  );
}

/** `verify.verdict`: the E1 verdict the graph routes on. */
function verdict(state: ReplayState, data: Payload): ReplayState {
  const entry: VerdictEntry = {
    buildAttempt: numberField(data, "buildAttempt"),
    ok: data.ok === true,
    score: numberField(data, "score"),
    errors: listField(data, "errors"),
  };
  return withNodes(
    { ...state, verdicts: [...state.verdicts, entry] },
    { verify: entry.ok ? "done" : "failed" },
  );
}

/** `repair.start`: the loop edge back from verify. */
function repairStart(state: ReplayState, data: Payload): ReplayState {
  const entry: RepairEntry = {
    buildAttempt: numberField(data, "buildAttempt"),
    fromRules: listField(data, "fromRules"),
  };
  return withEdge(
    withNodes(
      { ...state, repairs: [...state.repairs, entry] },
      { repair: "active" },
    ),
    "verify>repair",
  );
}

/** `plan.spec`: keep the parts of the spec the page shows. */
function planSpec(state: ReplayState, data: Payload): ReplayState {
  const spec = asPayload(data.spec) ?? {};
  return {
    ...state,
    spec: {
      title: textField(spec, "title"),
      gameType: textField(spec, "gameType"),
      input: textField(spec, "input"),
      style: textField(spec, "style"),
      lang: textField(spec, "lang"),
      langSource: textField(data, "langSource"),
    },
  };
}

const HANDLERS: Readonly<Record<string, Handler>> = {
  "step.start": stepStart,
  "step.result": stepResult,
  "phase.start": phaseStart,
  "verify.verdict": verdict,
  "repair.start": repairStart,
  "plan.spec": planSpec,
};

/** Text and tone of one log line, before its sequence number is attached. */
type LogLine = Omit<LogEntry, "seq" | "kind">;
type Describer = (data: Payload, attempt: string) => LogLine;

const DESCRIBERS: Readonly<Record<string, Describer>> = {
  "run.claimed": (data) => ({
    text: `run claimed (claim ${String(numberField(data, "claimAttempt"))})`,
    tone: "plain",
  }),
  "step.start": (data) => ({
    text: `step ${textField(data, "step")} started`,
    tone: "plain",
  }),
  "step.result": (data) => ({
    text: `step ${textField(data, "step")}: ${textField(data, "status")}`,
    tone: "plain",
  }),
  "phase.start": (data, attempt) => ({
    text: `${textField(data, "phase")} phase, ${attempt}`,
    tone: "signal",
  }),
  "tool.call": (data) => ({
    text: `${textField(data, "phase")} called ${textField(data, "tool")}`,
    tone: "plain",
  }),
  usage: (data, attempt) => ({ text: usageText(data, attempt), tone: "plain" }),
  "verify.verdict": (data, attempt) => verdictText(data, attempt),
  "repair.start": (data, attempt) => ({
    text: `repair from ${listField(data, "fromRules").join(", ")}, ${attempt}`,
    tone: "trip",
  }),
  "plan.spec": (data) => specText(data),
  "run.released": () => ({ text: "run released for a retry", tone: "trip" }),
};

/** Human-readable text and tone for one progress event. */
export function describeEvent(
  kind: string,
  data: Payload,
): Omit<LogEntry, "seq"> {
  const attempt = `attempt ${String(numberField(data, "buildAttempt"))}`;
  const describer = DESCRIBERS[kind];
  const line =
    describer === undefined
      ? { text: kind, tone: "plain" as const }
      : describer(data, attempt);
  return { kind, ...line };
}

/** Log text for a usage event. */
function usageText(data: Payload, attempt: string): string {
  const usage = asPayload(data.usage) ?? {};
  const tokens = `${String(numberField(usage, "input"))} in / ${String(numberField(usage, "output"))} out tokens`;
  return `${textField(data, "phase")} ${attempt}: ${tokens}`;
}

/** Log text and tone for an E1 verdict. */
function verdictText(data: Payload, attempt: string): LogLine {
  const score = numberField(data, "score").toFixed(SCORE_DECIMALS);
  if (data.ok === true)
    return { text: `E1 ${score} on ${attempt}: pass`, tone: "pass" };
  const rules = listField(data, "errors").join(", ");
  return {
    text: `E1 ${score} on ${attempt}: hard rule failed (${rules})`,
    tone: "trip",
  };
}

/** Log text for the planner spec. */
function specText(data: Payload): LogLine {
  const spec = asPayload(data.spec) ?? {};
  const parts = ["gameType", "input", "style", "lang"].map((key) =>
    textField(spec, key),
  );
  return { text: `plan: ${parts.join(" · ")}`, tone: "signal" };
}

/** Apply one progress message; stale or repeated sequence numbers are ignored. */
function progress(state: ReplayState, seq: number, raw: string): ReplayState {
  if (seq <= state.lastSeq) return state;
  const message = parsePayload(raw);
  const kind = message === null ? "" : textField(message, "kind");
  const data = (message === null ? null : asPayload(message.data)) ?? {};
  const handler = HANDLERS[kind];
  const next = handler === undefined ? state : handler(state, data);
  const entry = { seq, ...describeEvent(kind || "unrecognised", data) };
  return {
    ...next,
    phase: "streaming",
    lastSeq: seq,
    log: [...next.log, entry],
  };
}

/** The artifact from a terminal payload, when it has one. */
function artifactOf(data: Payload): ArtifactView | null {
  const artifact = asPayload(data.artifact);
  if (artifact === null) return null;
  const html = textField(artifact, "html");
  if (html === "") return null;
  return {
    version: textField(artifact, "version"),
    sha256: textField(artifact, "sha256"),
    html,
  };
}

/** Apply the terminal message: the run row's final status, E1 score and game. */
function terminal(state: ReplayState, seq: number, raw: string): ReplayState {
  const data = parsePayload(raw) ?? {};
  const status =
    textField(data, "status") === "complete" ? "complete" : "abandoned";
  const code = asPayload(data.attribution);
  const view: TerminalView = {
    status,
    e1Score: typeof data.e1Score === "number" ? data.e1Score : null,
    artifact: artifactOf(data),
    attribution:
      code === null
        ? null
        : `${textField(code, "step")}: ${textField(code, "code")}`,
  };
  const nodes =
    status === "complete"
      ? { finalize: "done" as const }
      : { reject: "failed" as const };
  const tone: LogTone = status === "complete" ? "pass" : "trip";
  const entry: LogEntry = {
    seq,
    kind: "terminal",
    text: `run ${status}`,
    tone,
  };
  return withNodes(
    {
      ...state,
      phase: status,
      terminal: view,
      lastSeq: seq,
      log: [...state.log, entry],
    },
    nodes,
  );
}

/** A log line that has no sequence number of its own. */
function note(
  state: ReplayState,
  text: string,
  tone: LogTone,
): readonly LogEntry[] {
  return [...state.log, { seq: null, kind: "connection", text, tone }];
}

/** Connection changes that only move the phase and add a note. */
const CONNECTION_NOTES = {
  reconnect: {
    phase: "reconnecting",
    text: "server asked the client to reconnect; resuming after the last event",
    tone: "plain",
  },
  "connection-lost": {
    phase: "reconnecting",
    text: "connection dropped; the browser is reconnecting with Last-Event-ID",
    tone: "trip",
  },
  stopped: {
    phase: "stopped",
    text: "stopped by the reader; closing the connection stops the run on the server",
    tone: "plain",
  },
} as const satisfies Record<
  string,
  { phase: RunPhase; text: string; tone: LogTone }
>;

/** Apply a connection change; a drop that follows a reconnect request adds no second note. */
function connectionChange(
  state: ReplayState,
  type: keyof typeof CONNECTION_NOTES,
): ReplayState {
  if (type === "connection-lost" && state.phase === "reconnecting")
    return state;
  const change = CONNECTION_NOTES[type];
  return {
    ...state,
    phase: change.phase,
    log: note(state, change.text, change.tone),
  };
}

/**
 * The replay panel's reducer: events in, view state out. It is pure, so the graph, log, score and
 * game frame can be tested against a real recorded SSE transcript without a browser.
 */
export function reduceReplay(
  state: ReplayState,
  action: ReplayAction,
): ReplayState {
  switch (action.type) {
    case "start":
      return {
        ...INITIAL_REPLAY_STATE,
        promptId: action.promptId,
        phase: "connecting",
      };
    case "progress":
      return progress(state, action.seq, action.data);
    case "terminal":
      return terminal(state, action.seq, action.data);
    case "failed":
      return {
        ...state,
        phase: "error",
        error: action.message,
        log: note(state, action.message, "trip"),
      };
    default:
      return connectionChange(state, action.type);
  }
}

/** Whether a replay is still running and its connection should stay open. */
export function isRunning(state: ReplayState): boolean {
  return (
    state.phase === "connecting" ||
    state.phase === "streaming" ||
    state.phase === "reconnecting"
  );
}
