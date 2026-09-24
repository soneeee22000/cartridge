# Eval report: sample / latest

## Run header

| field | value |
| --- | --- |
| tier | sample |
| label | latest |
| dataset version | v1 |
| planner / builder model | claude-sonnet-5 / claude-sonnet-5 |
| judge model | claude-haiku-4-5 |
| price table version | 2026-09-24 |
| scorer git sha | 597ba97 |

## Per-band results

### Outcomes

| band | n | games | contract-failed | refusals | harness failures |
| --- | --- | --- | --- | --- | --- |
| terse | 1 | 1 | 0 | 0 | 0 |
| short-brief | 1 | 1 | 0 | 0 | 0 |
| full-brief | 1 | 1 | 0 | 0 | 0 |
| edge | 1 | 1 | 0 | 0 | 0 |
| all | 4 | 4 | 0 | 0 | 0 |

### Quality

Game items only. There is no cross-band mean. E4 is match/mismatch/abstain, and an abstention is not a pass.

| band | E1 mean | E1 min | E2 passed/probed | E2 detector fails | E4 m/mm/abs | median build attempts |
| --- | --- | --- | --- | --- | --- | --- |
| terse | 1.000 | 1.000 | 1/1 | - | 1/0/0 | 2.0 |
| short-brief | 1.000 | 1.000 | 0/1 | idle-death 1 | 1/0/0 | 1.0 |
| full-brief | 1.000 | 1.000 | 1/1 | - | 1/0/0 | 1.0 |
| edge | 1.000 | 1.000 | 1/1 | - | 1/0/0 | 1.0 |

### E3 labels

Label counts on game items. `null` means no cited finding survived validation; `n/a` means the dimension does not apply. Labels are never averaged.

| band | dimension | labels |
| --- | --- | --- |
| terse | prompt-coverage | covered 1 |
| terse | goal-legibility | stated 1 |
| terse | feedback-on-input | immediate 1 |
| terse | fail-state-clarity | n/a 1 |
| short-brief | prompt-coverage | null 1 |
| short-brief | goal-legibility | stated 1 |
| short-brief | feedback-on-input | null 1 |
| short-brief | fail-state-clarity | explained 1 |
| full-brief | prompt-coverage | covered 1 |
| full-brief | goal-legibility | stated 1 |
| full-brief | feedback-on-input | immediate 1 |
| full-brief | fail-state-clarity | explained 1 |
| edge | prompt-coverage | covered 1 |
| edge | goal-legibility | stated 1 |
| edge | feedback-on-input | immediate 1 |
| edge | fail-state-clarity | explained 1 |

E4 labelled set: accuracy 1.000, abstention rate 0.000 (measured on 40 authored bundles; the thresholds were set on the same bundles).

## Repair loop

| build attempts | items |
| --- | --- |
| 1 | 3 |
| 2 | 1 |

| rule that triggered a repair | times |
| --- | --- |
| E1-24 | 1 |

## Failures by attributed step

No failures.

## Cost and latency

| tokens | input | output | cache read | cache write |
| --- | --- | --- | --- | --- |
| generator (claude-sonnet-5) | 124984 | 35553 | 0 | 0 |
| judge (claude-haiku-4-5) | 34312 | 2608 | 0 | 0 |
| of which repair passes | 30250 | 5268 | 0 | 0 |

Measured cache reads on repair passes: 0 tokens.

Estimated cost: $0.65 (estimate from list prices; not an invoice).

Wall time: 282.3 s in total, 68.8 s median per item (from run.json).

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
- differences between bands (one item per band)
- differences between game types (one item per type)

## Noise floor

One generation per item. With 1 item per band, one item moves a band rate by 100 points. Differences smaller than that are not interpretable.
