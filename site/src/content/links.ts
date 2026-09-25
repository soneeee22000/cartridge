/** The public repository (placeholder until the repo is pushed). */
export const REPO_URL = "https://github.com/soneeee22000/cartridge";

/** The author's GitHub profile. */
export const AUTHOR_URL = "https://github.com/soneeee22000";

/** A file on the repository's main branch. */
export function repoFile(path: string): string {
  return `${REPO_URL}/blob/main/${path}`;
}

/** A directory on the repository's main branch. */
export function repoTree(path: string): string {
  return `${REPO_URL}/tree/main/${path}`;
}

/** The architecture decision records, in order. */
export const ADRS: readonly {
  readonly id: string;
  readonly title: string;
  readonly path: string;
}[] = [
  {
    id: "ADR-0001",
    title: "An explicit workflow graph, not a single agent loop",
    path: "docs/adr/0001-explicit-workflow-graph.md",
  },
  {
    id: "ADR-0002",
    title:
      "A two-tier evaluator, with static rules first and a runtime probe second",
    path: "docs/adr/0002-two-tier-evaluator.md",
  },
  {
    id: "ADR-0003",
    title: "Cassette replay for a keyless demo with replayed model calls",
    path: "docs/adr/0003-cassette-replay-demo.md",
  },
];

/** The build contract. */
export const SPEC_PATH = "docs/SPEC.md";
/** Notes on the recorded runs, including the E2 caveats on generated games. */
export const PAID_RUNS_NOTE = "docs/research/s4-paid-runs.md";
/** Where the E2 thresholds and their margins are recorded. */
export const CALIBRATION_NOTE = "docs/research/e2-calibration.md";
