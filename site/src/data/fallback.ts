import dataset from "../../../dataset/prompts.v1.json";
import { type CatalogEntry, buildCatalog } from "../viewmodel/catalog";
import { fullReport } from "./report";

/** The replay catalog built at build time from the dataset and the committed report. */
export const FALLBACK_CATALOG: readonly CatalogEntry[] = buildCatalog(
  dataset.items,
  fullReport,
);
