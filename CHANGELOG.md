# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and entries are grouped by conventional-commit type.

## [Unreleased]

### Features

- **contract:** Zod schemas for the `postMessage` bridge (`boot`, `start`, `score`, `level`, `end`; host `pause`, `resume`, `reset`), the four game types with their rule table, and the `GameSpec`.
- **cards:** twelve knowledge cards (two contract, four type, three input, three style) and a loader with byte-stable listing and computed rule anchors.
- **e1:** the contract scorer: a balanced-brace payload scanner that knows strings, template literals, regex literals and comments; 24 hard/soft rules with fix hints and card-line citations; 4 metrics; `node src/eval/cli.ts score --file`.
- **scripts:** `check:clean-room` hashed-denylist scan and `build:vercel` Build Output API bundle with a placeholder `api/replay` handler.

### Chores

- Scaffold: Node 24, ESM, TypeScript strict, ESLint (typescript-eslint strict, type-checked), Vitest with coverage thresholds, CI `checks` job.
