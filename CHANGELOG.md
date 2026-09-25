# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and entries are grouped by conventional-commit type.

## [Unreleased]

### Features

- **contract:** Zod schemas for the `postMessage` bridge (`boot`, `start`, `score`, `level`, `end`; host `pause`, `resume`, `reset`), the four game types with their rule table, and the `GameSpec`.
- **cards:** twelve knowledge cards (two contract, four type, three input, three style) and a loader with byte-stable listing and computed rule anchors.
- **e1:** the contract scorer: a balanced-brace payload scanner that knows strings, template literals, regex literals and comments; 24 hard/soft rules with fix hints and card-line citations; 4 metrics; `node src/eval/cli.ts score --file`.
- **e2:** the runtime probe: a sandboxed srcdoc host at 360 × 640, a single injected error forwarder that keeps standards mode, pure frame metrics (luma spread, distinct colours, motion ratio), six detectors in a registry, a seeded random-tap bot that is reported only, and the `e2.json` schema.
- **fixtures:** four good controls (one per game type) and six known-bad tuning fixtures, each scoring E1 = 1.000 and built to trip one detector.
- **matrix:** `npm run eval:matrix` checks the five §9.2 conditions, exits 1 when any detector is disabled or uncovered, and writes `reports/committed/matrix.json`; CI re-runs it and diffs the verdicts.
- **fixtures:** six holdout fixtures, written after the thresholds were frozen, one per detector with a different defect mechanism; their verdicts are recorded in `matrix.json` as they are.
- **scripts:** `check:clean-room` hashed-denylist scan and `build:vercel` Build Output API bundle with a placeholder `api/replay` handler.
- **models:** a model port with live, record, replay and mock modes; fetch-layer cassettes keyed by the SHA-256 of the canonical request, storing raw streamed bytes and inter-chunk gaps; a replay-only model for the public functions.
- **engine:** the Mastra workflow graph (`plan → dountil(build-cycle) → branch(finalize | reject)`), the `save_draft` / `load_draft` tools, a run store (LibSQL and in-memory) with claims, heartbeated leases and a seal lease, a lifecycle driver, and an SSE relay that resumes from `Last-Event-ID`.
- **server:** a dev server with `POST /runs` and `GET /runs/:id/events`, a driver queue and a sweeper for rows left open by an earlier process.
- **dataset:** twenty authored prompts (EN and FR) across four length bands, with a schema, band word-count checks and a privacy guard.
- **eval:** a versioned price table and `one` / `sample` / `full` tiers with a pre-run estimate, `--max-usd` and a full-tier `--yes` guard; `--resume` and `--missing-e2`.
- **e3:** a cited categorical judge: every finding needs `file:line` evidence that is checked, numeric claims are discarded, and an unsupported dimension is `null`.
- **e4:** a language-match check over extracted UI strings, with an abstention floor and a 40-bundle labelled set.
- **report:** per-band markdown and deterministic `cartridge-report/1` JSON, with a noise-floor note and a "not measured" list; CI re-scores the committed games with no key and diffs the reports.
- **api:** `GET /api/replay?promptId=&pace=` streams a keyless replay of the real engine as SSE, and `GET /api/prompts` lists the replayable prompts; an import-graph test keeps `api/**` away from the live and record paths, LibSQL and Playwright.
- **site:** the project page, with a keyless replay (fast-forward or recorded pace), the evaluation write-up read from the committed reports, captured media under a contract, and a Build Output bundle that serves the page and the functions from one project.

### Fixes

- **engine:** runs fence every write with a per-claim lease id, allow one open run per run key, serialise artifact saves, and stop a builder call at the first step that spends a token budget.
- **server:** a throwing handler answers 500 or 400 instead of crashing the dev server; released runs are driven again and stale rows are reaped.
- **e1:** the E1-24 message names the functions the reset branch calls, so a repair can wire the right one.
- **e3:** the judge has one nullable slot per dimension, so a repeating answer cannot reach the output cap; a failed judge call is counted as `judge-error`.
- **eval:** the tier cost estimate is re-derived from the regenerated sample report.

### Chores

- Recorded the `one`, `sample` and `full` tiers (the full tier: 20 items, $3.15 estimated) and committed every game, cassette and report.
- CI: `eval-replay` job (matrix and report diffs) and a gitleaks history scan.
- Scaffold: Node 24, ESM, TypeScript strict, ESLint (typescript-eslint strict, type-checked), Vitest with coverage thresholds, CI `checks` job.
