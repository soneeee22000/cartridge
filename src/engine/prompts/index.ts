import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assetRoot, getCard } from "../../cards/index.ts";
import type { GameSpec } from "../../contract/spec.ts";
import type { Verdict } from "../../eval/e1/score.ts";

export type PromptName = "planner" | "builder";

/**
 * Reads an agent's instructions from `src/engine/prompts/<name>.md` under the asset root. The text
 * holds no run id or timestamp, so cassette keys stay stable (§4.2).
 * @param name prompt file stem
 */
export function loadPrompt(name: PromptName): string {
  const path = join(assetRoot(), "src", "engine", "prompts", `${name}.md`);
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n").trim();
}

/**
 * The planner's user message.
 * @param prompt the player's brief
 */
export function plannerMessage(prompt: string): string {
  return `Brief:\n\n${prompt.trim()}`;
}

/**
 * The five cards a build needs, in id order: game-page, bridge, the type, the input and the style.
 * @param spec the plan
 */
export function buildCardIds(spec: GameSpec): string[] {
  return [...new Set(["game-page", "bridge", spec.gameType, spec.input, spec.style])].sort();
}

function cardSection(spec: GameSpec): string {
  return buildCardIds(spec)
    .map((id) => `### Card \`${id}\`\n\n${getCard(id).body}`)
    .join("\n\n");
}

function repairSection(verdict: Verdict): string {
  const lines = verdict.errors.map(
    (finding) => `- ${finding.ruleId}: ${finding.message} Fix: ${finding.fix}`,
  );
  return [
    "## Failed rules",
    "",
    "The saved draft broke these hard rules. Call `load_draft` first, fix each one, then save the whole page again with `save_draft`.",
    "",
    ...lines,
  ].join("\n");
}

/**
 * The builder's user message: the plan, the cards and, on a repair pass, the failed rules as
 * `ruleId + message + fix` lines (§4.2).
 * @param spec the plan
 * @param verdict the previous attempt's verdict on a repair pass, otherwise null
 */
export function builderMessage(spec: GameSpec, verdict: Verdict | null): string {
  const parts = [
    "## Plan",
    "",
    "```json",
    JSON.stringify(spec, null, 2),
    "```",
    "",
    "## Cards",
    "",
    cardSection(spec),
  ];
  const task = verdict
    ? repairSection(verdict)
    : "## Task\n\nWrite the complete game page for this plan and save it with `save_draft`.";
  return [...parts, "", task].join("\n");
}
