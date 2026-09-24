# ADR-0003: Cassette replay for a keyless live demo

- Status: Accepted
- Date: 2026-09-24

## Context

The project page should let a visitor run the engine and watch the graph execute: plan, generate, verify, a repair pass, and the finished game playing in the page. Three constraints apply:

- **No public paid endpoint.** A page that calls a live model with our key can be scripted by anyone into a bill, and rate limiting does not remove that risk.
- **No fake demo.** A page that plays a pre-rendered animation and calls itself a live run misrepresents the project. The demo has to run the real code.
- **Serverless limits.** Vercel functions are capped at 300 s on Hobby, and separate invocations may run on separate instances with no shared memory.

## Decision

Record the model calls once, locally, with a real key. Replay them in the deployed demo through the real engine.

- **The fetch layer.** Recording and replay sit at the HTTP fetch layer of `@ai-sdk/anthropic` (SPEC §7.2).
  - A cassette is keyed by `sha256` of the canonical request body.
  - It stores the provider's raw streamed response bytes and the inter-chunk gaps, and never any headers. Every model call uses the streaming API, so there is one response format, and only 2xx responses are recorded.
  - Replay passes a fixed placeholder API key to the provider, which insists on a key before calling `fetch`. The placeholder is never sent anywhere, because the cassette layer answers every request.
  - In replay mode, a request with no recording throws `cassette-miss`. It never falls through to the network.
- **Everything except the model runs for real:**
  - the workflow graph;
  - the tools and artifact store;
  - the E1 verify phase and the repair loop;
  - the run lifecycle and the SSE relay.
- **Determinism.** Prompts contain no volatile values (run ids, timestamps; `assertNoVolatile` enforces this), and tool results contain no run ids. So the replayed requests hash to the recorded keys, and two replays emit identical event sequences.
- **One invocation per replay.** `GET /api/replay` creates the run in memory, drives it and relays it within a single invocation. A reconnect with `Last-Event-ID` re-runs the replay quickly and emits only the missing events.
- **The public surface cannot go live.** The `api/` handlers hard-code `mode: "replay"`, and an import-graph test fails if `api/**` can reach the live or record model constructors, `@libsql/client` or `playwright`.
- **Bundled, not traced.** The functions are bundled with esbuild into the Build Output API format, with cards, prompts, cassettes and the dataset copied beside them, so the demo does not depend on Vercel's file tracing (SPEC §13.3).
- **Honest label.** The page and the README use the label "Live demo (replayed model calls)", to be confirmed at deploy time, and state which parts are recorded. E2 results on the page are committed results, and the page says so.

The same cassettes serve CI. The eval report, including E3 judge outputs, is regenerated from committed cassettes and games with no key, and diffed byte for byte.

## Reasons

1. **Honest and still interactive.** The visitor runs the real orchestrator, and the recorded part is exactly the part that costs money. This passes the question "is this actually running?": yes, everything except the model call.
2. **Zero cost and zero abuse surface.** No key is deployed, so there is nothing to abuse.
3. **Recording at the fetch layer is exact.** It replays real provider bytes, including usage and cache fields, so cost panels show recorded behaviour, not recomputed guesses. It also doesn't depend on the internal stream-part types of the AI SDK version.
4. **One mechanism, three uses:** the demo, CI and $0 re-scoring (`eval:rescore`).

## Consequences

- The demo can only run prompts that were recorded. The prompt list comes from the cassette sets, and a free-text box would be misleading, so there isn't one.
- Any change to prompts, card text, tool schemas or the model id changes request hashes and invalidates cassettes. Re-recording costs money, and CI catches staleness as `cassette-miss`.
- Replayed timing is the recorded timing (capped per gap) or accelerated. It is labelled as such.
- The provider's settings accept a custom `fetch` (checked in the installed types), so the fetch layer is the design. A hand-rolled `LanguageModelV3` cassette that replays stream parts remains the documented fallback; it is more coupled to the SDK but has the same file keys.
- After the `terminal` event the client closes the `EventSource`, and the server answers 204 to a reconnect at or past the terminal id, so a finished replay is never re-run in a loop.

## Alternatives considered

- **A live endpoint behind rate limits or a captcha.** Rejected: there would still be a public path to a paid key.
- **A recorded video or GIF labelled "demo".** Kept as the fallback only if hosting fails. It would have to carry the "Walkthrough" label and could not be called live.
- **A mock model that returns canned games without the graph running.** Rejected: the demo would no longer exercise the orchestrator, the verifier or the repair loop, which are the things the page exists to show.
- **Running the work in the background after the response (`waitUntil`).** Not needed for replay, and it shares the same duration cap anyway.
