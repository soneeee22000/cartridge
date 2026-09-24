import type { GraphEdge, GraphNode } from "./replay-state";

/** A point in SVG user units. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One drawn node: its centre, size and the two lines of text it carries. */
export interface NodeBox {
  readonly id: GraphNode;
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
}

/** One drawn edge: a polyline and an optional label position. */
export interface EdgeLine {
  readonly id: GraphEdge;
  readonly points: readonly Point[];
  readonly label: Point | null;
}

/** A full graph layout for one orientation. */
export interface GraphLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly NodeBox[];
  readonly edges: readonly EdgeLine[];
}

/** Which way the main path runs. */
export type Orientation = "wide" | "narrow";

const ARROW_LENGTH = 9;
const ARROW_HALF_WIDTH = 5;
const LABEL_GAP = 8;
const LABEL_NUDGE = 4;
const LABEL_DROP = 18;

const WIDE = Object.freeze({
  width: 720,
  height: 236,
  nodeWidth: 116,
  nodeHeight: 52,
  rowTop: 64,
  rowBottom: 180,
  plan: 72,
  generate: 236,
  verify: 400,
  repair: 318,
  outcome: 620,
  branchX: 512,
});

const NARROW = Object.freeze({
  width: 340,
  height: 540,
  nodeWidth: 124,
  nodeHeight: 52,
  left: 96,
  right: 262,
  plan: 40,
  generate: 150,
  verify: 260,
  repair: 205,
  outcome: 480,
  branchY: 360,
});

type Pair = readonly [number, number];

/** An edge from coordinate pairs, with an optional label anchor. */
function edge(id: GraphEdge, pairs: readonly Pair[], label?: Pair): EdgeLine {
  return {
    id,
    points: pairs.map(([x, y]) => ({ x, y })),
    label: label === undefined ? null : { x: label[0], y: label[1] },
  };
}

/** Nodes of a layout, from each node centre. */
function nodesAt(
  centres: Readonly<Record<GraphNode, Pair>>,
  width: number,
  height: number,
): NodeBox[] {
  return (Object.entries(centres) as [GraphNode, Pair][]).map(
    ([id, [cx, cy]]) => ({
      id,
      cx,
      cy,
      width,
      height,
    }),
  );
}

/** The wide layout: the main path left to right, repair and reject on a second row. */
function wideLayout(): GraphLayout {
  const g = WIDE;
  const nodes = nodesAt(
    {
      plan: [g.plan, g.rowTop],
      generate: [g.generate, g.rowTop],
      verify: [g.verify, g.rowTop],
      repair: [g.repair, g.rowBottom],
      finalize: [g.outcome, g.rowTop],
      reject: [g.outcome, g.rowBottom],
    },
    g.nodeWidth,
    g.nodeHeight,
  );
  return { width: g.width, height: g.height, nodes, edges: wideEdges() };
}

/** Edges of the wide layout. */
function wideEdges(): EdgeLine[] {
  const g = WIDE;
  const halfW = g.nodeWidth / 2;
  const midY = (g.rowTop + g.rowBottom) / 2 + LABEL_NUDGE;
  return [
    edge("plan>generate", [
      [g.plan + halfW, g.rowTop],
      [g.generate - halfW, g.rowTop],
    ]),
    edge("generate>verify", [
      [g.generate + halfW, g.rowTop],
      [g.verify - halfW, g.rowTop],
    ]),
    edge(
      "verify>repair",
      [
        [g.verify, g.rowTop + g.nodeHeight / 2],
        [g.verify, g.rowBottom],
        [g.repair + halfW, g.rowBottom],
      ],
      [g.verify + LABEL_GAP, midY],
    ),
    edge("repair>generate", [
      [g.repair - halfW, g.rowBottom],
      [g.generate, g.rowBottom],
      [g.generate, g.rowTop + g.nodeHeight / 2],
    ]),
    edge(
      "verify>finalize",
      [
        [g.verify + halfW, g.rowTop],
        [g.outcome - halfW, g.rowTop],
      ],
      [g.verify + halfW + LABEL_GAP, g.rowTop - LABEL_GAP],
    ),
    edge(
      "verify>reject",
      [
        [g.branchX, g.rowTop],
        [g.branchX, g.rowBottom],
        [g.outcome - halfW, g.rowBottom],
      ],
      [g.branchX + LABEL_GAP, midY],
    ),
  ];
}

/** The narrow layout: the main path top to bottom, repair and reject in a right column. */
function narrowLayout(): GraphLayout {
  const g = NARROW;
  const nodes = nodesAt(
    {
      plan: [g.left, g.plan],
      generate: [g.left, g.generate],
      verify: [g.left, g.verify],
      repair: [g.right, g.repair],
      finalize: [g.left, g.outcome],
      reject: [g.right, g.outcome],
    },
    g.nodeWidth,
    g.nodeHeight,
  );
  return { width: g.width, height: g.height, nodes, edges: narrowEdges() };
}

/** Edges of the narrow layout. */
function narrowEdges(): EdgeLine[] {
  const g = NARROW;
  const halfW = g.nodeWidth / 2;
  const halfH = g.nodeHeight / 2;
  return [
    edge("plan>generate", [
      [g.left, g.plan + halfH],
      [g.left, g.generate - halfH],
    ]),
    edge("generate>verify", [
      [g.left, g.generate + halfH],
      [g.left, g.verify - halfH],
    ]),
    edge(
      "verify>repair",
      [
        [g.left + halfW, g.verify],
        [g.right, g.verify],
        [g.right, g.repair + halfH],
      ],
      [g.left + halfW + LABEL_GAP, g.verify + LABEL_DROP],
    ),
    edge("repair>generate", [
      [g.right, g.repair - halfH],
      [g.right, g.generate],
      [g.left + halfW, g.generate],
    ]),
    edge(
      "verify>finalize",
      [
        [g.left, g.verify + halfH],
        [g.left, g.outcome - halfH],
      ],
      [g.left + LABEL_GAP, g.branchY + LABEL_DROP * 2],
    ),
    edge(
      "verify>reject",
      [
        [g.left, g.branchY],
        [g.right, g.branchY],
        [g.right, g.outcome - halfH],
      ],
      [g.left + LABEL_GAP, g.branchY - LABEL_GAP],
    ),
  ];
}

/** The graph layout for an orientation. Both layouts draw the same nodes and edges. */
export function graphLayout(orientation: Orientation): GraphLayout {
  return orientation === "wide" ? wideLayout() : narrowLayout();
}

/**
 * The three corners of an arrowhead at the end of a polyline, pointing along its last segment.
 * Arrowheads are drawn as polygons rather than markers so they take the edge's own colour class.
 */
export function arrowHead(points: readonly Point[]): readonly Point[] {
  const tip = points.at(-1);
  const from = points.at(-2);
  if (tip === undefined || from === undefined) return [];
  const length = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (length === 0) return [];
  const ux = (tip.x - from.x) / length;
  const uy = (tip.y - from.y) / length;
  const baseX = tip.x - ux * ARROW_LENGTH;
  const baseY = tip.y - uy * ARROW_LENGTH;
  return [
    tip,
    { x: baseX - uy * ARROW_HALF_WIDTH, y: baseY + ux * ARROW_HALF_WIDTH },
    { x: baseX + uy * ARROW_HALF_WIDTH, y: baseY - ux * ARROW_HALF_WIDTH },
  ];
}
