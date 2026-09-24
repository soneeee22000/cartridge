import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GAME_TYPES } from "../contract/game-types.ts";
import { INPUT_CARD_IDS, STYLE_CARD_IDS } from "../contract/spec.ts";

/** Every card id, sorted (§3). */
export const CARD_IDS = [
  "bridge",
  "game-page",
  ...GAME_TYPES,
  ...INPUT_CARD_IDS,
  ...STYLE_CARD_IDS,
].sort();

export const CardKind = z.enum(["contract", "type", "input", "style"]);
export type CardKind = z.infer<typeof CardKind>;

const FrontMatter = z.object({
  id: z.string(),
  kind: CardKind,
  title: z.string().min(1),
  summary: z.string().min(1),
  related: z.array(z.string()),
});

/** Listing entry for a card: front matter only. */
export type CardSummary = z.infer<typeof FrontMatter>;

/** A loaded card. `lines` are the file's lines, so `lines[n - 1]` is file line `n`. */
export interface Card extends CardSummary {
  readonly body: string;
  readonly lines: readonly string[];
}

/** Where a rule anchor lives. `line` is 1-based. */
export interface Anchor {
  readonly card: string;
  readonly line: number;
}

export interface AnchorEntry extends Anchor {
  readonly ruleId: string;
}

const FRONT_MATTER_FENCE = "---";
const ANCHOR_PATTERN = /<!--\s*rule:([A-Z0-9-]+)\s*-->\s*$/;
const DEFAULT_ASSET_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Root that holds `src/cards/`; overridable for deploy bundles. */
export function assetRoot(): string {
  return process.env.CARTRIDGE_ASSET_ROOT ?? DEFAULT_ASSET_ROOT;
}

function parseScalar(raw: string): string | string[] {
  const value = raw.trim();
  if (!value.startsWith("[")) return value;
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseFrontMatter(
  lines: readonly string[],
  id: string,
): { meta: CardSummary; bodyStart: number } {
  if (lines[0]?.trim() !== FRONT_MATTER_FENCE)
    throw new Error(`card ${id}: missing front matter`);
  const end = lines.indexOf(FRONT_MATTER_FENCE, 1);
  if (end < 0) throw new Error(`card ${id}: unterminated front matter`);
  const fields: Record<string, string | string[]> = {};
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(":");
    if (colon > 0)
      fields[line.slice(0, colon).trim()] = parseScalar(line.slice(colon + 1));
  }
  const meta = FrontMatter.parse(fields);
  if (meta.id !== id)
    throw new Error(`card ${id}: front matter id is ${meta.id}`);
  return { meta, bodyStart: end + 1 };
}

/**
 * Loads one card by id from the asset root.
 * @param id card id, one of CARD_IDS
 */
export function getCard(id: string): Card {
  if (!CARD_IDS.includes(id)) throw new Error(`unknown card: ${id}`);
  const text = readFileSync(
    join(assetRoot(), "src", "cards", `${id}.md`),
    "utf8",
  );
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const { meta, bodyStart } = parseFrontMatter(lines, id);
  const body = lines.slice(bodyStart).join("\n").trim();
  return { ...meta, body, lines };
}

/** Lists every card's front matter, sorted by id with stable key order. */
export function listCards(): CardSummary[] {
  return CARD_IDS.map((id) => {
    const { kind, title, summary, related } = getCard(id);
    return { id, kind, title, summary, related };
  });
}

/** Lists every `<!-- rule:… -->` anchor across all cards. */
export function listAnchors(): AnchorEntry[] {
  const anchors: AnchorEntry[] = [];
  for (const id of CARD_IDS) {
    getCard(id).lines.forEach((line, index) => {
      const ruleId = ANCHOR_PATTERN.exec(line)?.[1];
      if (ruleId) anchors.push({ ruleId, card: id, line: index + 1 });
    });
  }
  return anchors;
}

/**
 * Resolves the one line that states a rule. Throws unless exactly one anchor matches.
 * @param ruleId rule id such as `E1-10`
 * @param card restrict the search to this card (for rules cited by a type or input card)
 */
export function resolveAnchor(ruleId: string, card?: string): Anchor {
  const matches = listAnchors().filter(
    (anchor) =>
      anchor.ruleId === ruleId && (card === undefined || anchor.card === card),
  );
  const [only] = matches;
  if (matches.length !== 1 || !only) {
    throw new Error(
      `rule ${ruleId}: expected one anchor, found ${matches.length} anchors`,
    );
  }
  return { card: only.card, line: only.line };
}

/**
 * Formats an anchor the way reports print it.
 * @param anchor resolved anchor
 */
export function cardCitation(anchor: Anchor): string {
  return `cards/${anchor.card}.md:${anchor.line}`;
}
