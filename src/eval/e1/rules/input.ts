import { passIf, type E1Rule } from "../types.ts";
import { listensFor } from "./helpers.ts";

const POINTER_EVENTS = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "touchstart",
] as const;

/** Rules cited by the input card. */
export const INPUT_RULES: readonly E1Rule[] = [
  {
    id: "E1-22",
    severity: "soft",
    card: "input",
    fix: 'Register pointer input on the canvas, e.g. canvas.addEventListener("pointerdown", onTap).',
    check: (game) =>
      passIf(
        listensFor(game, POINTER_EVENTS),
        "No pointer or touch input is registered.",
      ),
  },
];
