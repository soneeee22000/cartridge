/** One block of the "why" section: a fixed heading and rich-text paragraphs with placeholders. */
export interface WhyBlock {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

/** Why the evaluator has two tiers. Every number is filled from full.json. */
export const WHY_BLOCKS: readonly WhyBlock[] = [
  {
    heading: "A perfect static score",
    paragraphs: [
      "All {items} generated games scored E1 {score}: every applicable contract rule passed, from the bridge handshake to the ban on network and storage APIs.",
      "E1 reads the source. It cannot see a game that boots to a blank canvas, freezes after one frame or ignores taps.",
    ],
  },
  {
    heading: "Still broken at runtime",
    paragraphs: [
      "{runtimeFails} of those {items} games failed at least one E2 detector when they were loaded in headless Chromium. {e2Passed} of {items} passed every detector that applied to them.",
      "That gap is why the evaluator has two gating tiers: the free static tier on every repair pass, then the browser probe on what survives.",
    ],
  },
];

/** Caveat printed under the list of runtime failures. */
export const WHY_CAVEAT =
  "The E2 thresholds were tuned on this repo's own hand-authored fixtures, so a fail means the game fails this repo's definition, not that a defect rate was measured. At least one fail is the gate not fitting the game: in `kite-over-roofs` an idle kite falls by design, which trips `idle-death`. See [the recorded-run notes]({notes}).";
