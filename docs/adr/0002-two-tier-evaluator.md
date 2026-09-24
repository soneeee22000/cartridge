# ADR-0002: A two-tier evaluator, with static rules first and a runtime probe second

- Status: Accepted
- Date: 2026-09-24

## Context

A generated game can be judged in three ways:

- **Read its source.** Deterministic rules check the bridge contract, forbidden APIs and syntax. This is free, instant and reproducible.
- **Run it.** Load it in a headless browser, check that it boots, draws, moves, responds and doesn't crash. This takes seconds per game, needs Chromium, and is a little timing-sensitive.
- **Ask a model about it.** This costs money, is non-deterministic, and is only as good as its evidence.

Static rules are tempting as the only gate because they are cheap and exact. But a game can satisfy every source-level rule and still be unplayable. The canonical failures:

- it renders nothing;
- it draws one frame and freezes;
- it ignores taps;
- it kills an idle player within a second;
- it throws an error half a second into play.

None of these shows up in the source. A score of 1.000 from a static scorer says the contract text is present, not that the game works.

## Decision

The evaluator has two gating tiers and two reported-only signals (SPEC §2.3, §8, §10):

- **E1, the contract scorer (gate, tier 1).** Pure functions, each rule with a severity and a `card:line` citation computed from an anchor in the card. It runs inside the engine as the build-cycle's verify phase and again in the eval harness.
- **E2, the runtime probe (gate, tier 2).** Playwright Chromium, with the game in the same sandboxed iframe the demo uses. It has six detectors: boot handshake, blank frame, idle stillness, tap unresponsiveness, idle death (an `end` sooner than `IDLE_DEATH_MIN_SECONDS` after `start` for real-time types, with the value set from this repo's fixture calibration), and console errors. `longestPlaySeconds`, from a seeded random-tap bot, is **reported only**.
- **E3, a cited categorical judge (reported only).** Every finding needs `file:line` evidence that is checked against the file. Numeric claims are discarded. A dimension with no valid finding is `null`, not the worst score.
- **E4, language match (reported only).** The prompt language against the language of the game's UI strings. It abstains below an evidence floor.

**"Static ≠ quality" is demonstrated on fixtures, not asserted.** Six hand-authored known-bad fixtures each score E1 = 1.000 and are built to trip exactly one E2 detector. Four good controls trip none. The thresholds are tuned on these same fixtures, so this shows the gap exists by construction; it is not a detection rate. Six further holdout fixtures, written after the thresholds are frozen, are reported as they come out, misses included. The detection matrix (`npm run eval:matrix`) exits 1 if any fixture misbehaves, **or if any detector is disabled or covered by no fixture**. A mutant-style test disables each detector in turn and asserts the matrix fails.

## Reasons

1. **Cheap first, expensive second.** E1 runs on every repair pass for free, so the engine never pays for a browser run on a game that is already broken in its source.
2. **Two tiers catch different defect classes.** The fixtures make the gap concrete: every known-bad fixture passes E1 in full and is still broken. The holdout set is the only check that the detectors generalise beyond the games they were tuned on, and it is small, so claims stay at "demonstrated on N hand-authored fixtures".
3. **A detector nobody exercises is a detector nobody trusts.** Tying each detector to a fixture, and failing CI when the pairing breaks, stops silent regressions. For example, a threshold "tuned" until it never fires would be caught.
4. **Model judgement is kept away from gating.** E3 is useful colour but can be steered and varies from run to run. It never decides pass or fail, and it cannot report a number it did not cite.
5. **An honest `null`.** Abstentions (E4) and unsupported findings (E3) are "not measured", never a silent zero or a silent pass.

## Consequences

- E2 cannot run on Vercel functions. The live demo shows committed E2 results and says so.
- E2 metrics depend on timing, so CI diffs only the matrix **verdicts**. Fixtures are designed to sit far from thresholds, and the thresholds are frozen with the calibration measurements next to them (`docs/research/e2-calibration.md`).
- E2 thresholds are tuned on this repo's own fixtures, so they encode our definition of "blank" and "moving". The report states this under "Out of scope for this run", and no result from any other system is cited.
- `longestPlaySeconds` is a weak signal, because a random-tap bot is not a player. It is reported so trends are visible, and it never gates.

## Alternatives considered

- **Static rules only.** Rejected: see Context. The fixtures exist to show why.
- **An LLM judge as the quality gate.** Rejected for gating (non-deterministic, steerable, costly). It is kept as E3, reported only and with strict citations.
- **A weighted composite score over all tiers.** Rejected. A single number hides which tier failed and invites tuning the weights. Each tier is reported on its own, per stratum.
- **A full gameplay agent (a model playing the game).** Out of scope. The cost and variance are too high for a gate. The seeded bot covers the cheap part.
