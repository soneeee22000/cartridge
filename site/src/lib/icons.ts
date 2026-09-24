import {
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleMinus,
  CircleX,
  Info,
  Play,
  Repeat,
  Square,
  TriangleAlert,
} from "lucide";
import { esc } from "./dom";

type IconShape = ReadonlyArray<readonly [string, object]>;

const ICONS = {
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  circle: Circle,
  "circle-check": CircleCheck,
  "circle-minus": CircleMinus,
  "circle-x": CircleX,
  info: Info,
  play: Play,
  repeat: Repeat,
  square: Square,
  "triangle-alert": TriangleAlert,
} satisfies Record<string, IconShape>;

/** Names of the Lucide icons this page uses. */
export type IconName = keyof typeof ICONS;

const ICON_VIEWBOX = "0 0 24 24";
const STROKE_WIDTH = 1.5;
const PRESENTATION = `fill="none" stroke="currentColor" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"`;

/** Serialise an icon node's attributes. */
function attributes(attrs: object): string {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${esc(String(value))}"`)
    .join(" ");
}

/** The child elements of an icon. */
function children(name: IconName): string {
  const shape: IconShape = ICONS[name];
  return shape.map(([tag, attrs]) => `<${tag} ${attributes(attrs)}/>`).join("");
}

/** An inline, decorative Lucide icon for HTML contexts. */
export function icon(name: IconName, className = ""): string {
  return `<svg class="icon ${className}" viewBox="${ICON_VIEWBOX}" ${PRESENTATION}>${children(name)}</svg>`;
}

/** A Lucide icon positioned inside another SVG. */
export function iconAt(
  name: IconName,
  x: number,
  y: number,
  size: number,
  className: string,
): string {
  return `<svg class="${className}" x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${ICON_VIEWBOX}" ${PRESENTATION}>${children(name)}</svg>`;
}
