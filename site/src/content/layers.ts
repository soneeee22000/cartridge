/** Copy for one layer of the stack. Placeholders in braces are filled from the committed reports. */
export interface LayerCopy {
  readonly step: "1" | "2" | "3" | "4" | "5";
  readonly name: string;
  readonly heading: string;
  readonly problem: string;
  readonly answer: readonly string[];
  readonly caveat: string | null;
}

/** The five layers, bottom (the request) to top (the eval harness). Wording follows the ADRs. */
export const LAYERS: readonly LayerCopy[] = [
  {
    step: "1",
    name: "Request",
    heading: "Request: one short brief, English or French",
    problem:
      "A brief can be two words or a page, and some contradict themselves. A generator that only works on tidy briefs is a demo.",
    answer: [
      "The dataset has {items} authored prompts in {bands} length bands, {perBand} per band: terse, short brief, full brief and edge cases.",
      "The UI language is set in code from the prompt's language, with the same detector E4 uses. It is not a model instruction.",
    ],
    caveat: "I wrote every prompt myself. They are not user traffic.",
  },
  {
    step: "2",
    name: "Workflow graph",
    heading: "Workflow graph: plan, build cycle, finalize or reject",
    problem:
      "One tool-calling loop with a step cap cannot say which step failed, and one stubborn rule can use up its whole budget.",
    answer: [
      "An explicit Mastra workflow with typed step I/O: `plan`, then `build-cycle` (generate, then verify) until E1 passes or {maxRepairs} repairs are spent, then `finalize` or `reject`.",
      "The stop rule is a pure function with unit tests, and every failure carries `{ step, code, attempt, ruleIds }`.",
    ],
    caveat: null,
  },
  {
    step: "3",
    name: "Tools and cards",
    heading: "Tools and cards: {cards} short knowledge cards, four tools",
    problem:
      "A model writing a whole game from memory drifts from the contract, and a generic file or shell tool can do anything.",
    answer: [
      "The planner reads cards through `list_cards` and `get_card`: two contract cards, four game types, three input patterns and three styles.",
      "The builder writes only through `save_draft` and reads back with `load_draft`. The E1 `verify` tool is not given to the builder, so the repair loop stays in the graph.",
    ],
    caveat: null,
  },
  {
    step: "4",
    name: "Verifiers",
    heading: "Verifiers: E1 static rules, then the E2 runtime probe",
    problem:
      "A game can satisfy every source-level rule and still render nothing, freeze, ignore taps or throw half a second in.",
    answer: [
      "E1 is deterministic: pure rule functions with severities and `card:line` citations. It runs inside the graph on every build attempt, for free.",
      "E2 loads the game in headless Chromium and runs six detectors: boot handshake, blank frame, idle stillness, tap response, idle death and console errors.",
    ],
    caveat:
      "E2 needs a browser, so it runs offline in the eval harness, never on this page's server.",
  },
  {
    step: "5",
    name: "Eval harness",
    heading:
      "Eval harness: per-band report, detection matrix, keyless rescoring",
    problem:
      "A single headline score hides which tier failed and invites tuning the weights.",
    answer: [
      "Each tier is reported on its own, per length band: E1, E2, a cited categorical judge (E3) and language match (E4). E3 and E4 are reported only and never gate.",
      "Model calls are recorded as cassettes, so CI re-scores the committed report byte for byte with no API key.",
    ],
    caveat:
      "One generation per item. With {perBand} items per band, one item moves a band rate by {bandStep} points.",
  },
];
