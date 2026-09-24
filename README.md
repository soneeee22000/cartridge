Independent reimplementation. Contains no client code, prompts, data or assets.

# cartridge

An agentic generator for single-file HTML5 mini-games, built as an explicit workflow graph and checked by a two-tier evaluator: free static rules first, then a headless runtime probe.

This README is a placeholder while the engine is being built. The build contract is [docs/SPEC.md](docs/SPEC.md); design decisions are in [docs/adr/](docs/adr/).

## Status

Slice S1 is in place:

- the game contract: the `postMessage` bridge and the per-type rule table (`src/contract/`);
- twelve knowledge cards with a loader that resolves rule anchors to `cards/<card>.md:<line>` (`src/cards/`);
- the E1 contract scorer: 24 deterministic rules and 4 metrics (`src/eval/e1/`);
- the clean-room scan and the Vercel bundle path with a placeholder handler (`scripts/`).

Slice S2 added the workflow graph, model layer, run store and SSE relay (`src/engine/`, `src/models/`, `src/server/`).

Slice S3 adds the E2 runtime probe (`src/eval/e2/`, Playwright Chromium), hand-authored fixtures (`fixtures/`) and the detection matrix (`src/eval/matrix.ts`). The thresholds are calibrated on this repo's own fixtures; `docs/research/e2-calibration.md` lists every measurement.

The dataset, judge, reports and replay demo arrive in later slices.

## Commands

```sh
npm ci
npm run typecheck
npm run lint
npm test
node src/eval/cli.ts score --file path/to/game.html
npx playwright install chromium
npm run eval:matrix
npm run check:clean-room
npm run build:vercel
```

Requires Node 24.
