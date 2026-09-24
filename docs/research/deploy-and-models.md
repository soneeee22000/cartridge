# Research: deploy target, model table, canvas probing

Researched 2026-09-24. Sources are official docs fetched that day; every claim below cites its URL.
Local toolchain at research time: Vercel CLI 50.35.0 (npm latest is 59.26.0), Node v24.14.1.

---

## 1. Vercel: Node.js Functions with SSE next to a Vite static site

### 1.1 Limits that matter (Fluid compute, Node.js runtime)

| Limit                        | Hobby                                      | Pro / Enterprise                          | Source                                                                                                                                                  |
| ---------------------------- | ------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Max duration (default / max) | 300 s / 300 s                              | 300 s / 800 s (1800 s beta, per function) | [limitations](https://vercel.com/docs/functions/limitations#max-duration), [duration](https://vercel.com/docs/functions/configuring-functions/duration) |
| Memory / CPU                 | 2 GB / 1 vCPU (fixed)                      | 2 GB default, 4 GB / 2 vCPU max           | [limitations](https://vercel.com/docs/functions/limitations#memory-size-limits)                                                                         |
| Bundle size (uncompressed)   | 250 MB                                     | 250 MB (5 GB "large functions" beta)      | [limitations](https://vercel.com/docs/functions/limitations#bundle-size-limits)                                                                         |
| Request / response body      | 4.5 MB (413 `FUNCTION_PAYLOAD_TOO_LARGE`)  | same                                      | [limitations](https://vercel.com/docs/functions/limitations#request-body-size)                                                                          |
| File descriptors             | 1,024 shared across concurrent invocations | same                                      | [limitations](https://vercel.com/docs/functions/limitations#file-descriptors)                                                                           |
| Default region               | `iad1`, single region                      | up to 3 regions (Pro)                     | [limitations](https://vercel.com/docs/functions/limitations)                                                                                            |

- **Fluid compute is on by default** for projects created after 2025-04-23; it can also be forced with
  `"fluid": true` in `vercel.json` ([fluid-compute](https://vercel.com/docs/fluid-compute#enabling-fluid-compute)).
  It is available on Hobby.
- **Streaming counts against max duration.** "For request handlers, this includes time spent processing
  the request and sending the response, including streamed responses." Timeout returns 504
  `FUNCTION_INVOCATION_TIMEOUT` ([limitations](https://vercel.com/docs/functions/limitations#max-duration)).
- **Streaming is on by default** for all Node.js functions (changelog linked from
  [streaming-functions](https://vercel.com/docs/functions/streaming-functions)). Returning a Web `Response`
  whose body is a `ReadableStream` with `Content-Type: text/event-stream` is the documented shape.
- **Active CPU billing**: waiting on I/O (model calls) is not billed as active CPU
  ([limitations → cost](https://vercel.com/docs/functions/limitations#cost-and-usage)). An SSE stream that
  mostly waits on the LLM is cheap in CPU, but still holds the invocation open against the duration cap.
- **Idle connections**: over HTTP/1.1, intermediaries may close idle connections; the docs say to "stream
  progress or heartbeat data while work is running" ([duration → extended](https://vercel.com/docs/functions/configuring-functions/duration#extended-max-duration-beta)).

**Design consequence for the engine.** A full generate → verify → repair loop can exceed 300 s on Hobby.
So `POST /runs` must return 202 + `runId` immediately (as the plan already says), and the SSE endpoint must
be a _resumable tail_ of a persisted event log, not the thing doing the work:

1. SSE handler sets `maxDuration` to the plan's maximum, emits a heartbeat comment line (`: ping\n\n`)
   every ~15 s, and closes itself cleanly before the cap (budget e.g. 280 s on Hobby).
2. Each event carries an `id:`; the browser's `EventSource` reconnects automatically with
   `Last-Event-ID`, and the handler replays from that id.
3. In the keyless replay demo the work is cassette playback, so it fits well inside one invocation; the
   reconnect path is still what makes a live (keyed) run safe.
4. Background work after the response: `waitUntil` from `@vercel/functions` is supported under Fluid
   ([fluid-compute](https://vercel.com/docs/fluid-compute)), but it shares the same duration cap, so it is
   not a way around the 300 s limit. For truly long runs the doc points to Vercel Workflows.

### 1.2 Handler shape (Node.js runtime, non-Next project)

From [runtimes/node-js](https://vercel.com/docs/functions/runtimes/node-js#create-a-node.js-function-in-/api):
files in `/api` are functions; TypeScript is compiled by Vercel; both of these are valid:

```ts
// api/hello.ts: Web standard fetch export
export default {
  fetch(request: Request) {
    return new Response("Hello from Vercel!");
  },
};
```

```ts
// api/hello.ts: per-method exports
export function GET(request: Request) {
  return new Response("Hello from Vercel!");
}
```

Per-function config for non-Next `/api` routes uses an exported `config` object
([duration](https://vercel.com/docs/functions/configuring-functions/duration)):

```ts
export const config = { maxDuration: 300 };
```

or `vercel.json` → `"functions": { "api/runs/*.ts": { "maxDuration": 300 } }`.

TypeScript notes: a root `tsconfig.json` is honoured, **but "Path Mappings" and "Project References" are not
supported** ([runtimes/node-js → TypeScript](https://vercel.com/docs/functions/runtimes/node-js#using-typescript-with-the-node.js-runtime)).
So `api/*.ts` must import engine code by relative path or by package name, never via `paths` aliases.

Node version: 24.x is the default for new projects; pin with `"engines": { "node": "24.x" }` in
`package.json` ([node-js-versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)).
Node 20 is being deprecated on 2026-10-01 (changelog link on the same page).

### 1.3 Colocating the Vite site with `/api` in one project

Option A (recommended): **zero-config `api/` directory**. One Vercel project, framework preset Vite:
Vite's `dist/` is served as static, and every file under `api/` becomes a Node function. SPA deep links need
a rewrite ([frameworks/vite](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas));
it must exclude `/api`, otherwise the catch-all swallows function routes:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
}
```

The Vite doc itself steers Vite users toward Nitro for backends; that is optional. The plain `/api`
convention from the Node runtime doc works for any project and avoids one more framework.

Option B: **Build Output API** ([build-output-api/primitives](https://vercel.com/docs/build-output-api/primitives)).
The build script writes `.vercel/output/static/**` (the Vite build) and
`.vercel/output/functions/api/<name>.func/` with a `.vc-config.json`:

```json
{
  "runtime": "nodejs24.x",
  "handler": "index.mjs",
  "launcherType": "Nodejs",
  "maxDuration": 300,
  "supportsResponseStreaming": true
}
```

Files above the `.func` directory are _not_ included, so the build must bundle the engine (esbuild) into the
`.func` directory. The primitives page's example shows `nodejs22.x`; `nodejs24.x` is listed as a supported
runtime id on the [duration page](https://vercel.com/docs/functions/configuring-functions/duration#extended-max-duration-beta).
It is only worth using if option A's file tracing misbehaves.

### 1.4 Can a function import a sibling package in the same repo?

Yes, with conditions:

- Vercel bundles each `/api` function with file tracing, so relative imports (`../src/engine/...`) inside
  the project root are included automatically.
- Code **outside the project's Root Directory** is only available if "Include source files outside of the
  Root Directory in the Build Step" is enabled. It is on by default for projects created after 2020-08-27
  ([monorepo-faq](https://vercel.com/docs/monorepos/monorepo-faq#can-i-share-source-files-between-projects-are-shared-packages-supported)).
- npm / pnpm / yarn / Bun workspaces are supported; every workspace package needs a unique `name`, and
  internal dependencies must be declared in each `package.json`
  ([monorepos → requirements](https://vercel.com/docs/monorepos#requirements)).
- `includeFiles` / `excludeFiles` in `vercel.json` `functions` adjust what is traced
  ([limitations → bundle size](https://vercel.com/docs/functions/limitations#bundle-size-limits)).

**Recommendation:** keep it a single package. Root Directory is the repo root, the engine lives in `src/`, the
site in `site/` (Vite `root`), and functions in `api/` import `../src/...` by relative path. That removes
workspaces, path aliases and project references from the deploy path entirely. If the repo later splits into
workspaces, import the engine by package name and consume it as built JS (`dist/`) rather than TS source.

### 1.5 CLI

The local CLI is 50.35.0. npm `latest` is 59.26.0, so the pinned CLI is several majors behind. Pin the version
used in CI explicitly (e.g. `npx vercel@50.35.0`) so local and CI agree, and re-check `vercel build` output
before upgrading. No deploy was run as part of this research.

---

## 2. Model table (estimated, versioned)

Sources: the bundled Claude API reference (cached 2026-06-24), cross-checked against
[platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing.md)
on 2026-09-24. The two sources agree.

### 2.1 Exact model ids

| Role                | Model            | Id                 | Context | Max output |
| ------------------- | ---------------- | ------------------ | ------- | ---------- |
| Planner / generator | Claude Sonnet 5  | `claude-sonnet-5`  | 1M      | 128K       |
| Judge / cheap tiers | Claude Haiku 4.5 | `claude-haiku-4-5` | 200K    | 64K        |

Use the ids exactly as written, with no date suffix. (`claude-haiku-4-5-20251001` exists as a pinned snapshot alias.)

### 2.2 Price table to embed in code (label: estimated)

USD per million tokens, first-party Claude API, global routing:

```ts
export const PRICE_TABLE_VERSION = "2026-09-24";
export const PRICES_ARE_ESTIMATES = true;

export const PRICE_TABLE = {
  "claude-sonnet-5": {
    input: 2.0,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4.0,
    cacheRead: 0.2,
    output: 10.0,
  },
  "claude-haiku-4-5": {
    input: 1.0,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2.0,
    cacheRead: 0.1,
    output: 5.0,
  },
} as const;
```

Notes that affect the cost estimator:

- Sonnet 5 at $2/$10 was introductory pricing until 2026-08-31. The pricing page now says it "is now the standard
  price" and that the planned rise to $3/$15 "will not occur". The version string on the table exists because of
  this kind of change.
- Batch API: 50% off input and output (Sonnet 5 $1/$5, Haiku 4.5 $0.50/$2.50). This fits an offline eval sweep,
  not the live run path.
- `inference_geo: "us"` multiplies every category by 1.1x. Default global routing uses standard price.
- There is no long-context surcharge on Sonnet 5; the full 1M context is billed at the standard rate.
- Tokenizer: Sonnet 5 uses the newer tokenizer (about 30% more tokens than Sonnet 4.6 for the same text).
  Measure with `messages.count_tokens` rather than reusing old per-character estimates.
- The tool-use system prompt adds overhead per request: Sonnet 5 354 tokens (`auto`), Haiku 4.5 496 tokens.
- Compute cost from `usage` fields: `input_tokens`, `cache_creation_input_tokens`
  (split by TTL in `usage.cache_creation`), `cache_read_input_tokens`, `output_tokens`.

### 2.3 API behaviour differences between the two ids

|                                   | Sonnet 5                                                                    | Haiku 4.5                                                 |
| --------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Thinking                          | adaptive on by default; `{type:"disabled"}` accepted; `budget_tokens` → 400 | `{type:"enabled", budget_tokens:N}` (≥1024, < max_tokens) |
| `effort`                          | `low` / `medium` / `high` / `xhigh` / `max`                                 | errors                                                    |
| `temperature` / `top_p` / `top_k` | non-default values rejected (400)                                           | allowed                                                   |
| Assistant prefill                 | 400                                                                         | allowed                                                   |
| Min cacheable prefix              | 1,024 tokens                                                                | 4,096 tokens                                              |

The judge on Haiku can keep `temperature: 0`. The generator on Sonnet 5 cannot, so determinism for the
replay demo has to come from cassettes, not from sampling parameters. Structured output
(`output_config.format`, or `strict: true` tools) replaces prefill for the typed `GameSpec`.

### 2.4 Prompt caching for repeated card retrieval

- **Order the prompt stable → volatile.** Render order is `tools` → `system` → `messages`. Put the frozen
  system prompt and tool definitions first, then the retrieved cards, then the per-run request. A byte change
  anywhere in the prefix invalidates everything after it.
- **Explicit breakpoint at the end of the shared part.** Top-level auto-caching puts the breakpoint on the
  last block. If the prompt ends in the unique run request, every call pays the write premium and never reads.
  Put `cache_control: {type: "ephemeral"}` on the last _shared_ block. There are at most 4 breakpoints per
  request.
- **Card retrieval must be deterministic.** Sort retrieved cards by a stable key (card id), serialise with
  stable key order, and include no timestamps or run ids in the cached segment. Two runs that retrieve the same
  card set then share a cache entry. A tiered layout helps: breakpoint 1 after system + tools (always shared),
  breakpoint 2 after the card block (shared per game type).
- **Minimum prefix size.** Below 1,024 tokens (Sonnet 5) or 4,096 (Haiku 4.5), caching is silently skipped:
  no error, `cache_creation_input_tokens: 0`. A small card set on the Haiku judge may never cache. Measure
  before assuming savings.
- **Caches are model-scoped.** Sonnet and Haiku entries never share. Repair turns on the same model within 5
  minutes read the generate turn's prefix.
- **TTL choice.** Repair loops re-send within seconds, so the default 5-minute TTL is strictly cheaper. Keep
  the 1-hour TTL (2x write) for gaps of 5–60 minutes only.
- **Economics.** Write is 1.25x base (5 min) or 2x (1 h); a read is 0.1x. With 5-minute TTL, one read already
  pays back the write.
- **Verify** with `usage.cache_read_input_tokens` on the second call. If it stays 0, a silent invalidator is
  present, such as unsorted JSON or a varying tool list.
- **Replay demo.** Cassettes should record the `usage` block verbatim so the cost panel shows real cache
  behaviour from the recorded run, not a recomputed guess.

Sources: bundled Claude API skill `shared/prompt-caching.md`,
[prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md),
[pricing → prompt caching](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching).

---

## 3. Headless Chromium canvas probing without native deps

### 3.1 Versions (checked with `npm view` on 2026-09-24)

| Package        | Latest | Note                                                                                                                     |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| `pngjs`        | 7.0.0  | pure JS, no native deps, `engines.node >=14.19.0`, last published 2023-02-20 (stable, not abandoned-risky for a decoder) |
| `@types/pngjs` | 6.0.5  | types cover the `PNG.sync` API used below                                                                                |
| `playwright`   | 1.63.0 | Chromium build `chromium-1243` already in the local browser cache                                                        |
| `pixelmatch`   | 7.2.0  | optional; not needed for a ratio-of-changed-pixels metric                                                                |

The pngjs API was checked against `@types/pngjs/index.d.ts`:
`PNG.sync.read(buffer: Buffer): PNGWithMetadata` with `{ width, height, data: Buffer }` where `data` is RGBA,
4 bytes per pixel.

### 3.2 Verified approach (smoke-run locally)

- `page.locator('canvas').screenshot()` returns a PNG `Buffer` of just the canvas element. It works for 2D and
  WebGL alike, because it captures composited pixels. `getImageData` would fail on WebGL contexts without
  `preserveDrawingBuffer` and on tainted canvases.
- **Luma stddev**: per pixel `Y = 0.2126R + 0.7152G + 0.0722B`, single pass `sqrt(E[Y²] − E[Y]²)`,
  clamped at 0 for float error.
- **Distinct colour count**: `Set` of `data.readUInt32BE(offset)` (RGBA packed). Cap the set size or sample
  on large canvases if memory matters.
- **Motion**: take two canvas screenshots a fixed interval apart, and count pixels whose summed |ΔR|+|ΔG|+|ΔB|
  exceeds a threshold, divided by pixel count. Check size equality first. `requestAnimationFrame` does run in
  headless Chromium.

Smoke result (headless Chromium via Playwright 1.63.0, 320x240 canvas, 250 ms frame gap, diff threshold 16):

| Page                             | stddev                  | distinct colours | motion ratio |
| -------------------------------- | ----------------------- | ---------------- | ------------ |
| animated ball on dark background | 24.52                   | 86               | 0.0488       |
| solid black fill                 | ~0 (3.8e-6 float noise) | 1                | 0            |

The two cases separate cleanly on all three signals. Thresholds for the verifier (for example "blank if
stddev < ε or distinct colours ≤ N", "static if motion < M") must be named constants tuned on the engine's
own fixture games, not copied from anywhere.

Reference implementation used for the smoke run (to become `src/verify/canvas-metrics.ts` under TDD, with
functions split under 30 lines):

```ts
import { PNG } from "pngjs";

const CHANNELS = 4;
const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

export function canvasStats(png: Buffer): {
  stddev: number;
  distinctColours: number;
} {
  const { width, height, data } = PNG.sync.read(png);
  const colours = new Set<number>();
  let sum = 0;
  let sumSq = 0;
  for (let offset = 0; offset < data.length; offset += CHANNELS) {
    const luma =
      LUMA.r * data[offset]! +
      LUMA.g * data[offset + 1]! +
      LUMA.b * data[offset + 2]!;
    sum += luma;
    sumSq += luma * luma;
    colours.add(data.readUInt32BE(offset));
  }
  const pixels = width * height;
  const mean = sum / pixels;
  return {
    stddev: Math.sqrt(Math.max(0, sumSq / pixels - mean * mean)),
    distinctColours: colours.size,
  };
}
```

Practical notes:

- Unit tests do not need a browser. Build fixture PNGs in-memory with `new PNG({ width, height })` plus
  `PNG.sync.write`, then assert the metrics. Only the integration test launches Chromium.
- Wait for the bridge `boot` / `start` event (engine's own names) before the first screenshot, so the loading
  screen is not scored as the game.
- Headless Chromium renders WebGL through a software rasteriser, so it is slower. Keep the probe canvas small
  and the frame gap fixed.
- In CI, `npx playwright install --with-deps chromium` is the only extra step; pngjs adds no native build.
