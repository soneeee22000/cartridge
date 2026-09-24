# ADR-0001: An explicit workflow graph, not a single agent loop

- Status: Accepted
- Date: 2026-09-24

## Context

cartridge turns a short natural-language brief into a single-file HTML5 mini-game. The work has four stages:

1. choose a game type, input pattern and visual style;
2. write the HTML;
3. check it against the contract;
4. fix what failed.

The common way to build this is one tool-calling agent in a long loop. It gets a system prompt that says "retrieve, write, verify, repair until compliant", plus a step cap. The model decides the order, how often to verify and when to stop. I have worked with that pattern before, and its failure modes are the reason for this decision:

- **No attribution.** A bad run ends with "the agent hit the step cap". Nothing records whether the plan was wrong, the writer kept making the same mistake, or the verifier was flaky.
- **Unbounded repair.** The repair loop is bounded only by the global step cap. One stubborn rule can use up the whole budget, and the cost of a run depends on how quickly the model gives up.
- **Verification is optional.** Whether the verifier runs, and what the agent does with the result, is a prompt instruction, not a guarantee.
- **Hard to replay.** Control flow lives inside model outputs. A recorded run can be replayed, but its structure can't be tested without the model.

## Decision

The run is an explicit Mastra workflow with typed step I/O (SPEC §4): `plan → dountil(build-cycle: generate → verify-static) → branch(finalize | reject)`.

- **Where the model is used:** only inside `plan` (structured `GameSpec` output) and `generate` (write through the `write_version` tool).
- **`verify-static` is a workflow step, not a tool the builder may choose to call.** It always runs, and its `Verdict` is what the graph routes on.
- **The repair loop is part of the graph.** It is capped at `MAX_REPAIRS = 3` and has its own token budget (`REPAIR_TOKEN_BUDGET`) as well as a run budget. The stop rule is a pure function with unit tests.
- **Failures are attributed.** Every failure carries `{ step, code, attempt, ruleIds }` (SPEC §4.5). A game that still breaks hard rules after the last repair is blamed on `generate`, which produced it, with the rule ids as evidence. `verify-static` is never blamed for what it detected.
- **The language decision is code.** `plan` sets the UI language from the prompt language using the same detector E4 uses. It is not a model instruction.

## Reasons

1. **Every run can be explained.** Step status, attempt history and the rule ids that triggered each repair are data, so the report can show where runs fail, not only that they fail.
2. **Cost is bounded by design.** The worst case is `1 + MAX_REPAIRS` generate calls under two token budgets, whatever the model decides.
3. **The graph can be tested without a model.** With a scripted mock model, every path (clean pass, repair then pass, repairs exhausted, budget exhausted, no artifact, refusal, truncated stream) is a fast unit test.
4. **The replay demo shows real structure.** Because control flow is code, the keyless demo (ADR-0003) runs the real graph, and a visitor can see a real repair loop happen step by step.
5. **Smaller prompts.** Each agent gets a short, single-purpose prompt and only the cards it needs, instead of one long "workflow" prompt.

## Consequences

- There is less room for the model to improvise. For example, it cannot decide to re-plan halfway through. A re-plan edge would have to be added to the graph on purpose.
- Two model calls (plan and generate) cost a little more prompt overhead than one long conversation. Byte-stable card ordering and prompt caching offset part of it.
- Mastra's `.dountil` always runs its body once. The loop body is therefore the whole `generate → verify-static` cycle, and the first pass is the initial generation, not a repair.
- Mastra's workflow-level token usage is not reliable (it read zero in the probe), so token accounting is ours.

## Alternatives considered

- **A single durable agent loop with a step cap.** Rejected for the four reasons in Context. It is simpler to write, but it cannot answer "which step failed" or bound repair cost.
- **Multi-agent (planner, coder and critic agents talking to each other).** Rejected. It adds conversational non-determinism where a deterministic verifier already gives a better critique signal.
- **No model in the loop for planning (a rule-based spec from keywords).** Rejected. The ultra-short and contradictory prompts in the dataset are exactly where rules fail. The plan step keeps the model and constrains it with a Zod schema.
