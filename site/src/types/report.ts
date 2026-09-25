/** Token counts for one role, as `cartridge-report/1` records them. */
export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** One E2 detector verdict for one game. */
export type DetectorVerdict = "pass" | "fail" | "n/a";

/** The committed E2 runtime probe result for one game. */
export interface ItemE2 {
  readonly consoleErrors: readonly string[];
  readonly detectors: Readonly<Record<string, string>>;
  readonly longestPlaySeconds: number;
  readonly metrics: Readonly<Record<string, number | null>>;
}

/** One dataset item's recorded run, as `reports/committed/full.json` lists it. */
export interface ReportItem {
  readonly id: string;
  readonly lang: string;
  readonly lengthBand: string;
  readonly gameType: string | null;
  readonly intendedType: string | null;
  readonly outcome: string;
  readonly buildAttempts: number;
  readonly e1Score: number | null;
  readonly repairRules: readonly string[];
  readonly e2: ItemE2 | null;
  readonly e3: {
    readonly dimensions: Readonly<Record<string, string | null>>;
    readonly discarded: readonly { readonly dimension: string }[];
  };
  readonly e4: { readonly verdict: string } | null;
  readonly wallMs: number | null;
}

/** Per-band E2 counts. */
export interface BandE2 {
  readonly probed: number;
  readonly passed: number;
  readonly detectorFails: Readonly<Record<string, number>>;
}

/** One length-band row of the report. */
export interface BandRow {
  readonly band: string;
  readonly n: number;
  readonly games: number;
  readonly contractFailed: number;
  readonly refusals: number;
  readonly harnessFailures: number;
  readonly medianBuildAttempts: number | null;
  readonly e1: { readonly mean: number | null; readonly min: number | null };
  readonly e2: BandE2;
  readonly e4: Readonly<Record<string, number>>;
}

/** The fields of a `cartridge-report/1` file this page reads. */
export interface Report {
  readonly format: string;
  readonly header: {
    readonly tier: string;
    readonly datasetVersion: string;
    readonly priceTableVersion: string;
    readonly models: Readonly<Record<string, string>>;
  };
  readonly totals: {
    readonly n: number;
    readonly games: number;
    readonly contractFailed: number;
    readonly refusals: number;
    readonly harnessFailures: number;
    readonly estUsd: number;
  };
  readonly bands: readonly BandRow[];
  readonly items: readonly ReportItem[];
  readonly repair: {
    readonly histogram: Readonly<Record<string, number>>;
    readonly triggers: Readonly<Record<string, number>>;
  };
  readonly cost: {
    readonly estUsd: number;
    readonly usdLabel: string;
    readonly wallMsMedian: number | null;
    readonly wallMsTotal: number;
    readonly repairCacheRead: number;
    readonly tokens: Readonly<Record<string, TokenUsage>>;
    readonly repairTokens: TokenUsage;
  };
  readonly e4Labelled: {
    readonly accuracy: number;
    readonly bundles: number;
    readonly abstentionRate: number;
    readonly note: string;
  };
  readonly notMeasured: readonly string[];
  readonly noiseFloor: string;
}

/** One fixture's verdict in the detection matrix. */
export interface MatrixEntry {
  readonly e1Score: number;
  readonly expected: string | null;
  readonly fired: readonly string[];
  readonly verdict: string;
}

/** `reports/committed/matrix.json`. */
export interface Matrix {
  readonly tuning: Readonly<Record<string, MatrixEntry>>;
  readonly holdout: Readonly<Record<string, MatrixEntry>>;
}
