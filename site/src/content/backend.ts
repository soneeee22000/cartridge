/** One run-table status and what it means. */
export interface StatusCopy {
  readonly status: string;
  readonly meaning: string;
}

/** The run lifecycle, in the run table's own vocabulary (SPEC §5.1). */
export const LIFECYCLE: readonly StatusCopy[] = [
  { status: "waiting", meaning: "Created, or released for another claim." },
  {
    status: "active",
    meaning: "Claimed by one driver, which heartbeats every {heartbeat} s.",
  },
  {
    status: "sealing",
    meaning:
      "The workflow ended in `finalize`. The artifact is committed under a {sealLease} s seal lease.",
  },
  { status: "complete", meaning: "Terminal. The game is on the row." },
  {
    status: "abandoned",
    meaning: "Terminal. An attributed failure is on the row.",
  },
];

/** Lifecycle rules, each backed by a test in the engine. */
export const LIFECYCLE_RULES: readonly string[] = [
  "A claim is one conditional update, so two drivers racing for a run produce exactly one winner.",
  "A retryable failure sends the run back to `waiting` while claims are left: up to {maxClaims} claims for dev runs and {maxClaimsEval} for eval runs, so each eval item's cost belongs to one generation.",
  "An `active` row with no heartbeat for {stale} s can be reclaimed. Every write is fenced to the claim's lease id, so a driver that lost its lease cannot write into the next claim's log.",
  "A deterministic failure, such as a contract still unmet, a cassette miss or a refusal, goes straight to `abandoned`. Retrying it would pay again for a different game.",
];

/** How the SSE relay behaves (SPEC §6). */
export const RELAY_RULES: readonly string[] = [
  "Every progress event is stored with a sequence number and sent as `id: <seq>`. A client that reconnects with `Last-Event-ID` gets only the events after it.",
  "The `terminal` event is built from the run row, never from the workflow stream. The page closes its `EventSource` when the terminal event arrives. On the replay endpoint a reconnect is replayed at instant pace, and once an instance has seen that item finish, a reconnect at or past its terminal id gets 204.",
  "The relay polls the store every {poll} ms, sends a comment heartbeat every {heartbeatRelay} s, and asks the client to reconnect before {budget} s, inside the function's {maxDuration} s limit.",
];

/** How cassette replay works (ADR-0003). */
export const CASSETTE_RULES: readonly string[] = [
  "Recording sits at the HTTP fetch layer of the Anthropic provider. A cassette is keyed by the sha256 of the canonical request body and stores the raw streamed response bytes and their timing, never headers.",
  "In replay a missing recording throws `cassette-miss`; it never falls through to the network. Prompts carry no run ids or timestamps, so replayed requests hash to the recorded keys.",
  "The public handlers build their models only through a replay-only constructor that reads no key and has no upstream. An import-graph test fails if anything under `api/` can reach the general model factory, the database client or Playwright.",
];
