import { CARD_KINDS, ENGINE_CONSTANTS } from "../content/engine";
import type { Report } from "../types/report";
import { formatScore } from "./format";
import { headlineFacts } from "./results";

const PERCENT = 100;
const MS_PER_SECOND = 1000;

/** Values for `{placeholder}` copy, every one derived from the report or the engine constants. */
export type CopyValues = Readonly<Record<string, string | number>>;

/** The number of items in each band; throws if the bands are not the same size. */
export function itemsPerBand(report: Report): number {
  const sizes = new Set(report.bands.map((band) => band.n));
  const [size] = [...sizes];
  if (sizes.size !== 1 || size === undefined)
    throw new Error("Bands differ in size; per-band copy would be wrong");
  return size;
}

/** Seconds from a millisecond constant, as a plain number. */
function seconds(ms: number): number {
  return ms / MS_PER_SECOND;
}

/** Every placeholder value the page's copy uses. */
export function copyValues(report: Report): CopyValues {
  const facts = headlineFacts(report);
  const perBand = itemsPerBand(report);
  const minScore = Math.min(...report.items.map((item) => item.e1Score ?? 0));
  return {
    items: facts.items,
    bands: report.bands.length,
    perBand,
    bandStep: PERCENT / perBand,
    score: formatScore(minScore),
    runtimeFails: facts.staticPerfectRuntimeFail,
    e3Labels: report.items.reduce(
      (sum, item) => sum + Object.keys(item.e3.dimensions).length,
      0,
    ),
    e3Discarded: report.items.reduce(
      (sum, item) => sum + item.e3.discarded.length,
      0,
    ),
    e2Passed: facts.e2Passed,
    cards: Object.values(CARD_KINDS).flat().length,
    maxRepairs: ENGINE_CONSTANTS.MAX_REPAIRS,
    maxClaims: ENGINE_CONSTANTS.MAX_CLAIMS,
    maxClaimsEval: ENGINE_CONSTANTS.MAX_CLAIMS_EVAL,
    heartbeat: seconds(ENGINE_CONSTANTS.HEARTBEAT_INTERVAL_MS),
    stale: seconds(ENGINE_CONSTANTS.STALE_ACTIVE_MS),
    sealLease: seconds(ENGINE_CONSTANTS.SEAL_LEASE_MS),
    poll: ENGINE_CONSTANTS.RELAY_POLL_MS,
    heartbeatRelay: seconds(ENGINE_CONSTANTS.RELAY_HEARTBEAT_MS),
    budget: seconds(ENGINE_CONSTANTS.RELAY_BUDGET_MS),
    maxDuration: ENGINE_CONSTANTS.MAX_DURATION_SECONDS,
    gapSeconds: seconds(ENGINE_CONSTANTS.REPLAY_MAX_GAP_MS),
    priceTable: report.header.priceTableVersion,
    usdLabel: report.cost.usdLabel,
  };
}
