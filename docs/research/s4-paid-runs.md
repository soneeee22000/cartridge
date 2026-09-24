# S4 paid runs (2026-09-24)

This note records what the first paid runs measured and which harness bugs they surfaced (SPEC §14 S4). Models: `claude-sonnet-5` plans and builds, `claude-haiku-4-5` judges. All USD figures are estimates from list prices, not an invoice (price table `2026-09-24`, checked on the official pricing page that day).

**What these numbers are.** One generation per item, four items, one item per length band. Each band rate moves by 100 points per item, so nothing here is a rate. The runs are plumbing checks.

## Runs

| run | tier   | items | games | contract-failed            | repair passes | est. USD | what it surfaced                                                                                                     |
| --- | ------ | ----- | ----- | -------------------------- | ------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | one    | 1     | 1     | 0                          | 0             | 0.13     | end to end works first time; recordings of an item were not cleared before re-recording                              |
| 2   | sample | 4     | 3     | 1 (`bubble-pop`, E1-24 ×4) | 3             | 0.80     | the E1-24 message did not name the function the reset branch calls, so three repairs chased the wrong fix            |
| 3   | sample | 4     | 4     | 0                          | 1             | 0.67     | E1-24 now converges in one repair; the judge repeated dimensions until the output cap truncated it (`maze-de-haies`) |
| 4   | sample | 4     | 4     | 0                          | 1             | 0.63     | a prompt-only judge fix did not hold (`phare-long` repeated)                                                         |
| 5   | sample | 4     | 4     | 0                          | 1             | 0.65     | keyed judge schema: no judge errors; this run is `reports/committed/sample.json`                                     |

Where each run lives in git history:

- **Run 1** (`one`): only its report survives, in `reports/one/run-1/`. Its `kite-over-roofs` game and cassettes were overwritten by run 2 before either run was committed, so runs 1 and 2 share commit `1dc3a0e` and that commit holds run 2's recording of the item. Run 1's first `end` was 3.389 s (its `report.json`); the committed `e2.json` from run 2 says 3.358 s. Run 1 cannot be replayed.
- **Run 2** (`sample`): `1dc3a0e`, report in `reports/sample/run-2/`.
- **Runs 3 to 5** (`sample`): one commit each (`89a93bc`, `ab44ab5`, `d8fcfb0`), each re-recording every item; the report at `reports/sample/latest/` is overwritten by each run and now holds run 5.

The report folders were first named after the plan's tier aliases; they were renamed to `run-1` and `run-2`, and the `label` field inside each report was edited to match. No other byte of those reports changed.

## Measured cache reads

Every request in every run reported `cache_read_input_tokens = 0` and `cache_creation_input_tokens = 0`, repair passes included. No request sets a cache breakpoint, so the byte-stable card prefix (§4.2) is never cached. The committed run's repair pass sent 30,250 uncached input tokens.

## E2 on generated games

All five `kite-over-roofs` recordings reported a first idle `end` between 0.93 and 3.92 s after `start`, below the frozen 4 s gate, so `idle-death` failed each time: in this tap-to-lift game an idle kite falls. That is the brief's design, not a defect, so these fails say the gate does not fit this kind of game; they do not say the game is broken. The gate was set on hand-authored fixtures only (§9) and stays frozen until new holdout fixtures are added. Reports now print this caveat under the quality table whenever an E2 detector fails, and their out-of-scope list already excludes E2 detection rates on generated games. Run 2's `maze-de-haies` scored E1 1.000 but threw a `TypeError` at boot because it draws before its grid exists, so `boot-handshake` and `console-error` failed. Run 3's `phare-long` failed `idle-static`. Run 3's `maze-de-haies` judge answer was truncated at the output cap, and its report showed four `null` E3 labels and "No failures"; after the S4 review a failed judge call is counted as `judge-error` and listed under failures instead. These are single observations, not detection rates.

## Replay

With `ANTHROPIC_API_KEY` unset, `run --tier sample --mode replay` over the committed cassettes reproduced every model-derived field exactly: spec, game sha256, usage, build attempts, repair rules, E1, E3 and E4. The E2 detector verdicts were also unchanged. Wall time and the Playwright pixel metrics differ, because they are measured again. `score --games games --tier sample` with no key regenerates `reports/committed/sample.json` byte for byte.
