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

### Chores

- Scaffold: Node 24, ESM, TypeScript strict, ESLint (typescript-eslint strict, type-checked), Vitest with coverage thresholds, CI `checks` job.
