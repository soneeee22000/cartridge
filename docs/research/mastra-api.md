# Mastra API notes (@mastra/core 1.70.0)

Verified on 2026-09-24 against the installed `.d.ts` files and the docs that ship inside the package (`node_modules/@mastra/core/dist/docs/`). The throwaway probe was installed outside the repo and was type-checked with `tsc --strict` (exit 0) and run on Node 24.14.1. Every behaviour marked **observed** comes from real probe output, not from the docs.

## 0. Versions to pin

| Package             | Version   | Why                                                                                                                              |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@mastra/core`      | `1.70.0`  | engine (Node `>=22.13.0`)                                                                                                        |
| `@mastra/libsql`    | `1.23.2`  | local file storage. Peer range `@mastra/core >=1.68.0-0 <2.0.0-0`, depends on `@libsql/client ^0.18.0`                           |
| `zod`               | `4.6.5`   | peer `^3.25.0 \|\| ^4.0.0`. Import as `import { z } from 'zod'`                                                                  |
| `@ai-sdk/provider`  | `3.0.14`  | **types only** for the hand-rolled cassette model (`LanguageModelV3`). This is the exact version Mastra bundles as `provider-v6` |
| `@ai-sdk/anthropic` | `4.0.62`  | optional, only if we skip the model-router string (implements `LanguageModelV4`)                                                 |
| `ai`                | `7.0.113` | **devDependency only**, for `ai/test` (`MockLanguageModelV4`, `convertArrayToReadableStream`)                                    |
| `typescript`        | `5.9.3`   | the probe type-checked with this version                                                                                         |

- `@mastra/core` 1.70 does **not** depend on `ai`. It bundles the AI SDK spec packages under aliases: `@ai-sdk/provider-v5` = provider 2.0.3 (spec **V2**), `provider-v6` = 3.0.14 (spec **V3**), and `provider-v7` = 4.0.17 (spec **V4**). `MastraModelConfig` in `dist/llm/model/shared.types.d.ts` is:
  ```ts
  type MastraModelConfig =
    | LanguageModelV1
    | LanguageModelV2
    | LanguageModelV3
    | LanguageModelV4
    | ModelRouterModelId
    | OpenAICompatibleConfig
    | MastraLanguageModel;
  ```
  So **any object implementing the V2, V3 or V4 spec can be passed as `model`**.
- Node 24 native TS (strip-only) **rejects constructor parameter properties** (`constructor(private readonly x)`), with the error `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. **Observed.** If any script runs `.ts` directly without a build step, declare fields explicitly. Enums and namespaces fail for the same reason.

## 1. Workflows

Imports: `import { createWorkflow, createStep } from '@mastra/core/workflows'`.

### 1.1 Signatures (from `dist/workflows/workflow.d.ts` and `create.d.ts`)

```ts
createStep<TStepId, TStateSchema, TInputSchema, TOutputSchema, TResumeSchema?, TSuspendSchema?, TRequestContextSchema?>(
  params: { id; description?; inputSchema; outputSchema; stateSchema?; resumeSchema?; suspendSchema?;
            requestContextSchema?; retries?: number; scorers?; metadata?; execute }
): Step<...>
// Other overloads: createStep(agent, opts?), createStep(agent, { structuredOutput: { schema } }), createStep(tool, opts?), createStep(classifier, opts?)

createWorkflow({ id, inputSchema, outputSchema, stateSchema?, requestContextSchema?, retryConfig?: { attempts?, delay? }, options?, steps?, description? })
  .then(step) .parallel([a, b]) .branch([[cond, step], ...]) .dountil(step, cond) .dowhile(step, cond)
  .foreach(step, { concurrency }) .map(fn | mapping) .commit()
```

Schemas are any Standard-Schema-with-JSON value, and Zod 4 works directly. `execute` receives (`ExecuteFunctionParams`, `dist/workflows/step.d.ts`):

```ts
{ runId, workflowId, resourceId?, mastra, requestContext, inputData, state, setState(s): Promise<void>,
  resumeData?, suspendData?, retryCount, getInitData<T>(), getStepResult(stepOrId),
  suspend(payload?, opts?), bail(result), abort(), abortSignal, writer: ToolStream, engine, ... }
```

Condition functions (`branch`, `dountil`, `dowhile`) get the same params minus `setState`/`suspend`. Loop conditions also get **`iterationCount: number`**.

### 1.2 Verified composition (probe, type-checks under strict)

```ts
const generate = createStep({
  id: "generate",
  inputSchema: z.object({ spec: z.string(), attempt: z.number() }),
  outputSchema: Attempt, // z.object({ spec, attempt, ok, text })
  execute: async ({ inputData, mastra, requestContext, writer }) => {
    await writer.custom({
      type: "data-progress",
      data: { phase: "generate", attempt: inputData.attempt },
    });
    const agent = mastra.getAgentById("builder");
    const result = await agent.generate(inputData.spec, {
      requestContext,
      maxSteps: 3,
    });
    return {
      ...inputData,
      attempt: inputData.attempt + 1,
      ok: false,
      text: result.text,
    };
  },
});

const MAX_REPAIRS = 3;
const flow = createWorkflow({
  id: "probe-flow",
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ status: z.string() }),
})
  .then(plan)
  .then(generate)
  .dountil(
    repair,
    async ({ inputData, iterationCount }) =>
      inputData.ok || iterationCount >= MAX_REPAIRS,
  )
  .branch([
    [async ({ inputData }) => inputData.ok, finalize],
    [async ({ inputData }) => !inputData.ok, fail],
  ])
  .commit();
```

Semantics that affect our design (**observed**):

- **`.dountil` always runs its body at least once**, even when the condition is already true on entry. The first condition check sees `iterationCount === 1`. For "repair only if verify failed", do one of these:
  - put the loop behind a `.branch`
  - make the loop body a nested workflow `generate → verify` and start from attempt 0
  - use `.dowhile`, which also runs the body first, so the same caveat applies
- `.branch` output is keyed by the executed step id, with the other keys absent: `{ finalize: { status: 'done' } }`. A step after a branch needs optional keys per branch step. The workflow `result` in the probe was `{"finalize":{"status":"done"}}`.
- All steps in one `.branch` must share the input schema. The step inside `.dountil` must have input = output shape, so it can loop.
- A thrown error in a step gives `result.status === 'failed'`, `result.error.message` set, and `result.steps[stepId].status === 'failed'`. Previous steps stay `success`. The probe printed `count:success speak:success boom:failed`. This means **per-step failure attribution comes for free from `result.steps`**. Mastra also logs the stack to the console through its logger.
- There is **no `createRunAsync` in 1.70**, which I checked by grepping every `.d.ts`. `createRun` is itself async: `await workflow.createRun({ runId?, resourceId?, disableScorers?, pubsub?, shouldPersistSnapshot?, tracingPolicy? })`. A custom `runId` is honoured (observed: `fixed-run-id` round-tripped into storage).

### 1.3 Running

```ts
const run = await mastra.getWorkflow('flow').createRun({ runId });

// A. wait for the result
const result = await run.start({ inputData, requestContext, initialState? });
// result.status: 'success' | 'failed' | 'suspended' | 'tripwire' | 'paused'

// B. stream (returns WorkflowRunOutput synchronously, no await)
const out = run.stream({ inputData, requestContext, closeOnSuspend?, perStep?, outputOptions? });
for await (const chunk of out.fullStream) { /* WorkflowStreamEvent */ }
const final = await out.result;     // same union as start()
const usage = await out.usage;      // see caveat below

// Other Run methods: startAsync() → { runId } (fire-and-forget), cancel(), resume(), resumeStream(),
// restart(), timeTravel(), observeStream(). watch()/watchAsync() are marked @internal, so don't use them.
```

### 1.4 Stream events (`WorkflowStreamEvent`, `dist/stream/types.d.ts:955`)

Every chunk has `{ type, runId, from, payload, metadata? }`. The event order **observed** for plan → generate(agent + tool) → repair → finalize:

```
workflow-start {workflowId}
workflow-step-start {id:'plan', stepName, stepCallId, status, payload}
workflow-step-result {id:'plan', status, output}
workflow-step-start generate
data-progress                     ← writer.custom({ type: 'data-…', data })
workflow-step-result generate
workflow-step-start repair / workflow-step-result repair
workflow-step-start finalize / workflow-step-result finalize
workflow-finish {workflowStatus, output:{usage}, metadata}
```

- Other declared types: `workflow-step-output` (from `writer.write()` or `stream.textStream.pipeTo(writer)`, with `from: 'USER'` and `payload: { stepName, output }`), `workflow-step-suspended`, `workflow-step-waiting`, `workflow-step-progress` (foreach), `workflow-canceled`, `workflow-paused`, and `workflow-step-finish`. `workflow-step-finish` is **not** emitted in the default-engine probe, so key progress on `workflow-step-result`.
- The failed step also emits `workflow-step-result` (status `failed`), then `workflow-finish` with `workflowStatus: 'failed'`.
- Custom progress: `writer.custom({ type: 'data-<name>', data })` surfaces as a top-level chunk whose `type` is `data-<name>`. This is the clean hook for SSE progress. The terminal state must still come from our run row (plan rule).

### 1.5 Runtime context (`RequestContext`)

```ts
import { RequestContext } from "@mastra/core/request-context";
const requestContext = new RequestContext();
requestContext.set("run-tag", "abc");
run.stream({ inputData, requestContext });
// step:  execute: async ({ requestContext }) => requestContext.get('run-tag')
// agent: agent.generate(prompt, { requestContext })   // pass it on explicitly
// tool:  execute: async (input, context) => context?.requestContext?.get('run-tag')
```

**Observed:** the value set before `run.stream` reached the tool's `execute` through step → `agent.generate({ requestContext })` → tool. Typing: a `new RequestContext<{...}>()` is **not** assignable to the untyped workflow's `RequestContext<unknown>` (TS2322). Either keep it untyped, or declare `requestContextSchema` on the workflow and steps to get validation and typed `get`.

### 1.6 A step calling an agent or a model

- Preferred: register the agent on `new Mastra({ agents: { builder } })`, then inside a step call `mastra.getAgentById('builder')` (or `getAgent('<registration key>')`), and after that `.generate()` or `.stream()`. This path is verified.
- Streaming into the workflow: `const s = await agent.stream(prompt); await s.textStream.pipeTo(writer); return { text: await s.text };`. The text deltas arrive as `workflow-step-output` events. **Observed.**
- Agent as a step: `createStep(agent)` gives input `{ prompt: string }` and output `{ text: string }`. `createStep(agent, { structuredOutput: { schema } })` gives a typed output. This comes from the `.d.ts` and was not run.
- There's no `mastra.getModel()` helper. To call a model without an agent, use a one-off `Agent` with no tools, or call the V3/V4 object's `doGenerate` directly (rarely worth it).

### 1.7 Review probes (2026-09-24): nested loop body, attribution, stream ids

Probes `nested.ts`, `nested2.ts` and `fetchprobe.ts` (Mastra 1.70.0, TS 5.9.3, `@ai-sdk/anthropic@4.0.62`), run during the feasibility review of SPEC revision 1.

- **Nested workflow as a `.dountil` body does not type-check under `exactOptionalPropertyTypes`.** TS2379: `Workflow.description: string | undefined` is not assignable to `Step.description?: string`. Giving the nested workflow a `description` does not fix it (`nested2.ts`, same error). Without the flag it type-checks and runs as expected (at least one pass, then the branch). **Decision (SPEC §4.1):** the loop body is a single `build-cycle` step whose `execute` calls `runGenerate()` then `runVerify()`. The flag stays on and no cast is added.
- **`result.steps` cannot attribute inner failures.** With the nested body, a throw inside the inner verify step showed only `build-cycle: failed` in `result.steps` (probe with `THROW_AT=2`). A single-step body has the same limit. **Decision (SPEC §4.5):** each engine phase catches its own errors and records `{ step, code }` in `BuildState.failure`. Whether `result.error` keeps an error's custom fields is still unprobed; the design does not rely on it.
- **Stream ids.** Inside a nested workflow, step events carry dotted ids (`build-cycle.generate`, `build-cycle.verify-static`), plus an outer `build-cycle` start/result per iteration. `data-*` custom chunks written by nested steps do reach the outer `fullStream`. With the single-step body, `workflow-step-start/result` only ever name `build-cycle`, so per-phase progress comes from `data-cartridge` chunks (SPEC §6.1).
- **`autoRestartActiveRuns`** exists as a per-workflow `options` field (`workflows/types.d.ts:428`).

## 2. Agents, tools and custom model objects

### 2.1 Tools

```ts
import { createTool } from "@mastra/core/tools";
const saveDraft = createTool({
  id: "save_draft",
  description: "Store a new version of the game html",
  inputSchema: z.object({ html: z.string() }),
  outputSchema: z.object({ version: z.number() }),
  execute: async ({ html }, context) => ({ version: 1 }), // (inputData, context) — the only signature
});
const agent = new Agent({
  id: "builder",
  name: "Builder",
  instructions: "...",
  model,
  tools: { saveDraft },
});
```

**Observed gotcha:** the tool name the model sees (`callOptions.tools[].name`) is the **object key** (`saveDraft`), not the tool `id` (`save_draft`). Cassettes and prompts must use the key. Keep key === id to avoid confusion (for example `tools: { save_draft: saveDraft }`).

Agent call options (`agent.types.d.ts`): `generate(messages, { requestContext?, maxSteps?, stopWhen?, structuredOutput?, modelSettings?, providerOptions?, ... })`.

`FullOutput` fields:

- `text`
- `usage` (last step only)
- **`totalUsage`** (all steps)
- `steps`
- `toolCalls`
- `toolResults`
- `finishReason`
- `response`
- `request`
- `warnings`
- `object`
- `error`

### 2.2 Custom model object (cassette / replay): verified pattern

Implement `LanguageModelV3` from `@ai-sdk/provider@3.0.14` (the exact version Mastra bundles). No `ai` runtime dependency is needed.

```ts
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";

const usage = (input: number, output: number): LanguageModelV3Usage => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

class CassetteModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "cassette";
  readonly modelId = "replay";
  readonly supportedUrls = {};
  readonly calls: LanguageModelV3CallOptions[] = []; // record prompts for assertions / cassette keys
  readonly turns: readonly Turn[];
  #cursor = 0;
  constructor(turns: readonly Turn[]) {
    this.turns = turns;
  } // no parameter properties (Node strip-only)

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    /* return { content: [{ type: 'text', text }] | [{ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(args) }],
                finishReason: { unified: 'stop' | 'tool-calls', raw: undefined }, usage: usage(i, o), warnings: [] } */
  }
  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    /* return { stream: new ReadableStream<LanguageModelV3StreamPart>({ start(c) { parts.forEach(p => c.enqueue(p)); c.close(); } }) } */
  }
}
```

The stream parts used, in order:

- **Tool turn:** `stream-start {warnings: []}` → `response-metadata {id, modelId, timestamp}` → `tool-call {toolCallId, toolName, input: '<json string>'}` → `finish {finishReason: {unified: 'tool-calls', raw}, usage}`.
- **Text turn:** `stream-start` → `response-metadata` → `text-start {id}` → `text-delta {id, delta}` → `text-end {id}` → `finish {finishReason: {unified: 'stop', raw}, usage}`.

**Observed:** `agent.generate()` called **`doStream`** for both turns (2 calls: tool-call, then final text). Mastra executed `saveDraft` between them, and the result text was `saved v1`. Implement `doStream` as the primary path and keep `doGenerate` for completeness. `options.prompt` holds the full message list, so a cassette key can be `hash(options.prompt, options.tools)`.

### 2.3 `ai/test` mocks

- `ai@7.0.113` exports `MockLanguageModelV3`, `MockLanguageModelV4`, `convertArrayToReadableStream`, `simulateReadableStream` and `mockValues`.
- **`MockLanguageModelV4` works**: it type-checks as an `Agent` `model`, and at runtime `generate('hello')` returned `hi from mock` with `totalUsage` `{inputTokens:1, outputTokens:2, totalTokens:3, ...}`. **Observed.** It also works for streaming, via `doStream: { stream: convertArrayToReadableStream([...parts]) }`.
- **`MockLanguageModelV3` from `ai@7` does NOT type-check** (TS2322). It is typed against `@ai-sdk/provider@4.0.18`'s V3, not the 3.0.14 V3 that Mastra bundles. Don't use it. `MockLanguageModelV2` is not in `ai@7`; it lives in `ai@5`.
- Mastra also ships `@mastra/core/test-utils/llm-mock` (`createMockModel({ mockText, version: 'v1'|'v2' })`, `MastraLanguageModelV2Mock`). These are older-spec helpers, so prefer our cassette or `MockLanguageModelV4`.
- Decision suggestion: use the hand-rolled `CassetteModel` (V3, prod + demo replay) and `MockLanguageModelV4` (unit tests, devDependency).

## 3. Storage

- **Workflows do not require storage.** Without `storage`, Mastra logs `No \`storage\` configured on Mastra — falling back to an in-memory store...` and runs normally. **Observed.**
- In-memory, explicit (silences the warning; good for Vercel and tests):
  ```ts
  import { InMemoryStore } from "@mastra/core/storage";
  new Mastra({ storage: new InMemoryStore(), agents, workflows }); // constructor({ id? })
  ```
- LibSQL (local file):
  ```ts
  import { LibSQLStore } from "@mastra/libsql";
  new Mastra({
    storage: new LibSQLStore({ id: "cartridge", url: "file:./cartridge.db" }),
  });
  // 'url: ":memory:"' is also accepted (JSDoc example in mastra/index.d.ts)
  ```
  **Observed:** the probe created `probe2.db`, and `workflow.listWorkflowRuns()` returned `total: 1, runs: ['fixed-run-id']`, which means snapshots persisted. Relative `file:` paths resolve against the process cwd, so use an absolute path if two processes share the DB.
- Mastra storage persists **workflow snapshots** (for suspend/resume/restart), not our domain run rows. Our run lifecycle table (waiting/active/sealing/complete/abandoned, seal lease, claims; SPEC §5) should be our own table. It can live in the same libSQL file through `@libsql/client` directly, but it isn't Mastra's schema. Run `workflow.restartAllActiveWorkflowRuns()` on boot, or set `autoRestartActiveRuns: false` if we own recovery. Note: `autoRestartActiveRuns` is a **per-workflow** `options` field (`createWorkflow({ …, options: { autoRestartActiveRuns } })`, `workflows/types.d.ts:428`), not a Mastra-level option.

## 4. Anthropic

Two options, both type-check as `Agent.model`:

```ts
// A. Model router string — no provider package; reads ANTHROPIC_API_KEY from env
new Agent({ id, name, instructions, model: "anthropic/claude-sonnet-5" });

// B. AI SDK provider object (LanguageModelV4) — explicit key, easy to swap with the cassette
import { createAnthropic } from "@ai-sdk/anthropic";
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
new Agent({ id, name, instructions, model: anthropic("claude-sonnet-5") });
```

- `anthropic/claude-sonnet-5`, `anthropic/claude-opus-5` and `anthropic/claude-opus-5-5` are in Mastra's generated `ProviderModelsMap.anthropic` (`provider-types.generated.d.ts`). The env var is `ANTHROPIC_API_KEY` (from the provider registry). `@ai-sdk/anthropic@4.0.62`'s `AnthropicModelId` also lists `claude-sonnet-5`.
- Recommendation: **B**, behind a `ModelPort` factory (`live → anthropic(id)`, `replay → CassetteModel`, `test → MockLanguageModelV4`). This keeps the model injectable, and no global env magic decides the provider. A live Anthropic call was **not** made (no key used), so the router path is verified at the type level only.

### Token usage

- Per agent call: `result.totalUsage` (sum over steps) and `result.usage` (last step). The **observed** normalized shape is:
  `{ inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens, cacheCreationInputTokens, raw }`.
  With two model turns (11+13 input, 7+3 output), `totalUsage` gave `inputTokens: 24, outputTokens: 10, totalTokens: 34`. **`raw` holds only the last step's provider-shaped usage.**
- On the stream, the agent's `stream.totalUsage` / `stream.usage` are promises, and a `finish` chunk carries them.
- **Workflow-level usage (`out.usage`, `workflow-finish.payload.output.usage`) was all zeros** in both probes: with `agent.generate()` inside a step, and even with `textStream.pipeTo(writer)`. The docs claim that piping aggregates usage, but I didn't observe it. **We must account tokens ourselves**: sum `totalUsage` per step, record it on the step/attempt row, and enforce the repair-loop token budget from that number.

### Provider behaviour found in the review probes (2026-09-24)

- **Placeholder key for replay.** `createAnthropic` calls `loadApiKey` inside `getHeaders()` on every request, before the custom `fetch` runs. With `ANTHROPIC_API_KEY` unset and no `apiKey`, a replay throws `AI_LoadAPIKeyError: Anthropic API key is missing` (observed). Replay and mock modes pass a constant placeholder (`"replay-no-key"`); the cassette layer never forwards headers.
- **`agent.generate()` is non-streaming with this provider.** The request body had no `stream` flag and the provider expected a JSON body; given SSE it failed with "Invalid JSON response" (observed). The earlier note that generate goes through `doStream` came from the custom V3 model, not the V4 provider. **Decision:** every model call uses `agent.stream()` and awaits `totalUsage` / `object` / `finishReason`, so cassettes hold only `text/event-stream` bodies and long builder calls are not exposed to undici's 300 s `headersTimeout`.
- **Defaults to pin.** With no `maxOutputTokens`, the provider sends `max_tokens: 128000` (observed), and with no thinking parameter Sonnet 5 uses adaptive thinking. SPEC §4.4 adds `*_MAX_OUTPUT_TOKENS` constants and an explicit thinking/effort setting via `providerOptions.anthropic`; the exact option shape is to be read from the provider's `.d.ts` in S2.
- **Usage double-count trap.** Observed `totalUsage`: `inputTokens: 14` = `raw.inputTokens.noCache 10` + `cacheRead 4`, with `cachedInputTokens: 4` alongside. So normalised `inputTokens` already includes cache reads. SPEC §4.4 defines `Usage.input = inputTokens − cachedInputTokens − cacheCreationInputTokens`; whether `inputTokens` also includes cache writes is to be confirmed on a recorded response with a non-zero cache write.
- **Finish reasons.** The provider maps `max_tokens` and `model_context_window_exceeded` to `finishReason: "length"`, and `refusal` to `"content-filter"` (provider source).
- **Errors.** On a 529 the provider made one fetch call, did not retry, and `agent.generate` threw `AI_APICallError` "Overloaded" (observed). Classification uses `APICallError.isRetryable` and `statusCode`.
- **Sampling.** For models flagged `rejectsSamplingParameters`, the provider drops `temperature`/`topP`/`topK` with a warning; it does not return a 400.
- **Custom `fetch`.** The `createAnthropic` settings accept `fetch` (confirmed); the fetch-layer cassette is the design.
- **No volatile values** (UUIDs, ISO timestamps) appeared in the request bodies Mastra built.

## 5. Implications for cartridge (short)

1. The repair loop is `.dountil(build-cycle)`, where `build-cycle` is a single step running a generate phase then a verify phase (§1.7), and a `.branch` routes to `finalize` or `reject`. It should not be a bare `.dountil(repair)`, because that body always runs once. The iteration cap comes from our own `repairs` counter.
2. Failure attribution comes from `BuildState.failure` (set by each phase) plus our own attempt log, never from `result.steps` (§1.7).
3. SSE progress uses `writer.custom({ type: 'data-…' })` for per-phase events and `workflow-step-start/result` for top-level steps. Terminal state is read from our run row only.
4. The model is injected per run: `createCartridge(deps)` builds a Mastra instance per run with the chosen models (cassette-backed provider for the demo, `MockLanguageModelV4` for unit tests, `@ai-sdk/anthropic` for live runs) and tools that close over the run's artifact store.
5. Token accounting is ours: `totalUsage` from every agent call, mapped to disjoint kinds (§4). Workflow usage is not trusted.
6. Storage: Mastra uses `InMemoryStore` everywhere; our own run table uses `@libsql/client` locally and an in-memory store on Vercel.
