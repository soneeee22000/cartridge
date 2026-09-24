import { esc } from "./dom";

const COORDINATE_PRECISION = 10;

/** Text anchor positions for SVG text. */
export type TextAnchor = "start" | "middle" | "end";

/** Round a coordinate to one decimal so markup stays short and deterministic. */
export function round(value: number): number {
  return Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;
}

/** An SVG text element with escaped content. */
export function svgText(
  x: number,
  y: number,
  content: string,
  className: string,
  anchor: TextAnchor = "start",
): string {
  return `<text x="${round(x)}" y="${round(y)}" class="${className}" text-anchor="${anchor}">${esc(content)}</text>`;
}

/** An SVG rectangle. */
export function svgRect(
  x: number,
  y: number,
  width: number,
  height: number,
  className: string,
  radius = 0,
): string {
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${radius}" class="${className}"/>`;
}

/** An SVG line. */
export function svgLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  className: string,
): string {
  return `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" class="${className}"/>`;
}

/** An SVG circle. */
export function svgCircle(
  cx: number,
  cy: number,
  radius: number,
  className: string,
): string {
  return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${radius}" class="${className}"/>`;
}
