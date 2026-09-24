import { z } from "zod";
import { GameType } from "./game-types.ts";

export const TITLE_MAX_CHARS = 48;
export const SLUG_MAX_CHARS = 40;
export const LOOP_MAX_CHARS = 280;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Input cards a spec can name (§3). */
export const INPUT_CARD_IDS = [
  "tap-anywhere",
  "drag-follow",
  "swipe-lanes",
] as const;
export const InputCardId = z.enum(INPUT_CARD_IDS);
export type InputCardId = z.infer<typeof InputCardId>;

/** Style cards a spec can name (§3). */
export const STYLE_CARD_IDS = ["paper-cut", "chalkboard", "risograph"] as const;
export const StyleCardId = z.enum(STYLE_CARD_IDS);
export type StyleCardId = z.infer<typeof StyleCardId>;

/** UI languages the planner may choose. */
export const SPEC_LANGS = ["en", "fr"] as const;

/** The planner's typed output (§4.2). */
export const GameSpec = z.object({
  title: z.string().min(1).max(TITLE_MAX_CHARS),
  slug: z.string().max(SLUG_MAX_CHARS).regex(SLUG_PATTERN),
  lang: z.enum(SPEC_LANGS),
  gameType: GameType,
  loop: z.string().min(1).max(LOOP_MAX_CHARS),
  input: InputCardId,
  style: StyleCardId,
});
export type GameSpec = z.infer<typeof GameSpec>;
