# Eval report: one / run-1

## Run header

| field | value |
| --- | --- |
| tier | one |
| label | run-1 |
| dataset version | v1 |
| planner / builder model | claude-sonnet-5 / claude-sonnet-5 |
| judge model | claude-haiku-4-5 |
| price table version | 2026-09-24 |
| scorer git sha | 7378cf9 |

## Per-band results

### Outcomes

| band | n | games | contract-failed | refusals | harness failures |
| --- | --- | --- | --- | --- | --- |
| terse | 0 | 0 | 0 | 0 | 0 |
| short-brief | 1 | 1 | 0 | 0 | 0 |
| full-brief | 0 | 0 | 0 | 0 | 0 |
| edge | 0 | 0 | 0 | 0 | 0 |
| all | 1 | 1 | 0 | 0 | 0 |

### Quality

Game items only. There is no cross-band mean. E4 is match/mismatch/abstain, and an abstention is not a pass.

| band | E1 mean | E1 min | E2 passed/probed | E2 detector fails | E4 m/mm/abs | median build attempts |
| --- | --- | --- | --- | --- | --- | --- |
| terse | - | - | 0/0 | - | 0/0/0 | - |
| short-brief | 1.000 | 1.000 | 0/1 | idle-death 1 | 1/0/0 | 1.0 |
| full-brief | - | - | 0/0 | - | 0/0/0 | - |
| edge | - | - | 0/0 | - | 0/0/0 | - |

### E3 labels

Label counts on game items. `null` means no cited finding survived validation; `n/a` means the dimension does not apply. Labels are never averaged.

| band | dimension | labels |
| --- | --- | --- |
| terse | prompt-coverage | - |
| terse | goal-legibility | - |
| terse | feedback-on-input | - |
| terse | fail-state-clarity | - |
| short-brief | prompt-coverage | partly 1 |
| short-brief | goal-legibility | stated 1 |
| short-brief | feedback-on-input | immediate 1 |
| short-brief | fail-state-clarity | explained 1 |
| full-brief | prompt-coverage | - |
| full-brief | goal-legibility | - |
| full-brief | feedback-on-input | - |
| full-brief | fail-state-clarity | - |
| edge | prompt-coverage | - |
| edge | goal-legibility | - |
| edge | feedback-on-input | - |
| edge | fail-state-clarity | - |

E4 labelled set: accuracy 1.000, abstention rate 0.000 (measured on 40 authored bundles; the thresholds were set on the same bundles).

## Repair loop

| build attempts | items |
| --- | --- |
| 1 | 1 |

No repair was triggered.

## Failures by attributed step

No failures.

## Cost and latency

| tokens | input | output | cache read | cache write |
| --- | --- | --- | --- | --- |
| generator (claude-sonnet-5) | 20347 | 7565 | 0 | 0 |
| judge (claude-haiku-4-5) | 7814 | 1198 | 0 | 0 |
| of which repair passes | 0 | 0 | 0 | 0 |

Measured cache reads on repair passes: 0 tokens.

Estimated cost: $0.13 (estimate from list prices; not an invoice).

Wall time: 64.2 s in total, 64.2 s median per item (from run.json).

## Out of scope for this run

- fun or difficulty
- audio
- accessibility
- real-device performance
- multi-turn edits
- languages other than en/fr
- variance across repeated generations
- E3 agreement with human raters
- E4 accuracy beyond its 40 authored bundles
- E2 detection rates on generated games (the thresholds encode this repo's own fixture-based definitions)
- any band other than the single item's band
- any game type other than the single item's type

## Noise floor

One generation per item. With 1 item per band, one item moves a band rate by 100 points. Differences smaller than that are not interpretable.
