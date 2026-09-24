import type { E1Rule } from "../types.ts";
import { BRIDGE_RULES } from "./bridge.ts";
import { INPUT_RULES } from "./input.ts";
import { PAGE_RULES } from "./page.ts";
import { TYPE_RULES } from "./type.ts";

/** Every E1 rule, ordered by id (§2.3). */
export const E1_RULES: readonly E1Rule[] = [
  ...PAGE_RULES,
  ...BRIDGE_RULES,
  ...TYPE_RULES,
  ...INPUT_RULES,
].sort((left, right) => left.id.localeCompare(right.id));
