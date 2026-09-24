/** A limitation with a bold lead and rich-text detail. Placeholders in braces come from the reports. */
export interface LeadItem {
  readonly lead: string;
  readonly detail: string;
}

/** What the numbers on this page can and cannot support. */
export const LIMITATIONS: readonly LeadItem[] = [
  {
    lead: "One run.",
    detail:
      "Each of the {items} items was generated once. There is no variance estimate, and the report's noise floor says a difference smaller than one item per band is not interpretable.",
  },
  {
    lead: "I wrote the prompts.",
    detail:
      "The {items} briefs, their length bands and the edge cases are mine. They are not drawn from real users, and they cover English and French only.",
  },
  {
    lead: "The E3 judge is categorical and unvalidated.",
    detail:
      "It gives cited labels such as `stated` or `covered`, never numbers, and it has not been checked against human raters. It is reported only and never gates.",
  },
  {
    lead: "Ten E2 probes were re-run after generation.",
    detail:
      "During the full run Chromium failed to launch partway through, and ten probes crashed. They were re-run later with `--missing-e2`, keyless, against the same committed games.",
  },
  {
    lead: "The E2 thresholds come from this repo's own fixtures.",
    detail:
      "They were tuned on hand-authored games, so they encode this repo's definition of blank or unresponsive. The holdout fixtures show each detector can catch the defect it was written for. They are not a detection rate.",
  },
  {
    lead: "No live generation on the public page.",
    detail:
      "The replay runs the real orchestrator, verifiers and state machine, but every model call is served from a recorded cassette. Only the {items} recorded prompts can be replayed, so there is no free-text box.",
  },
  {
    lead: "Costs are estimates.",
    detail:
      "USD figures come from the list prices in the price table dated {priceTable}: {usdLabel}.",
  },
];
