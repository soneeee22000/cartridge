import { ENGINE_CONSTANTS } from "../content/engine";
import { type IconName, iconAt } from "../lib/icons";
import { round, svgText } from "../lib/svg";
import {
  type EdgeLine,
  type GraphLayout,
  type NodeBox,
  type Orientation,
  arrowHead,
  graphLayout,
} from "../viewmodel/graph";
import type {
  GraphEdge,
  GraphNode,
  NodeStatus,
} from "../viewmodel/replay-state";

/** What the graph shows: each node's status and the edges a run has taken. */
export interface GraphView {
  readonly nodes: Readonly<Record<GraphNode, NodeStatus>>;
  readonly edges: readonly GraphEdge[];
}

const NODE_RADIUS = 6;
const TITLE_RAISE = 4;
const SUB_DROP = 14;
const STATUS_ICON = 16;
const STATUS_INSET = 6;

/** The two lines each node carries. */
const NODE_COPY: Readonly<Record<GraphNode, readonly [string, string]>> = {
  plan: ["plan", "model: GameSpec"],
  generate: ["generate", "model: save_draft"],
  verify: ["verify", "E1 static rules"],
  repair: ["repair", `at most ${String(ENGINE_CONSTANTS.MAX_REPAIRS)}`],
  finalize: ["finalize", "seal the game"],
  reject: ["reject", "attributed failure"],
};

/** Labels on the branching edges. */
const EDGE_LABELS: Partial<Readonly<Record<GraphEdge, string>>> = {
  "verify>repair": "hard rule failed",
  "verify>finalize": "E1 ok",
  "verify>reject": "cap or budget",
};

/** The icon that marks a node's status; idle nodes have none. */
const STATUS_ICONS: Readonly<Record<NodeStatus, IconName | null>> = {
  idle: null,
  active: "circle",
  done: "circle-check",
  failed: "circle-x",
};

/** Words for a node status, used in the accessible summary. */
const STATUS_WORDS: Readonly<Record<NodeStatus, string>> = {
  idle: "not reached",
  active: "running",
  done: "done",
  failed: "failed",
};

/** One node: a box, its two lines of text and a status icon. */
function nodeMarkup(node: NodeBox, status: NodeStatus): string {
  const left = node.cx - node.width / 2;
  const top = node.cy - node.height / 2;
  const [title, sub] = NODE_COPY[node.id];
  const iconName = STATUS_ICONS[status];
  const statusIcon =
    iconName === null
      ? ""
      : iconAt(
          iconName,
          left + node.width - STATUS_ICON - STATUS_INSET,
          top + STATUS_INSET,
          STATUS_ICON,
          `gnode__icon gnode__icon--${status}`,
        );
  return `<g class="gnode gnode--${status}" data-node="${node.id}">
    <rect x="${round(left)}" y="${round(top)}" width="${node.width}" height="${node.height}" rx="${NODE_RADIUS}" class="gnode__box"/>
    ${svgText(node.cx, node.cy - TITLE_RAISE, title, "gnode__title", "middle")}
    ${svgText(node.cx, node.cy + SUB_DROP, sub, "gnode__sub", "middle")}
    ${statusIcon}
  </g>`;
}

/** One edge: its polyline, arrowhead and optional label. */
function edgeMarkup(edge: EdgeLine, taken: boolean): string {
  const points = edge.points
    .map((point) => `${round(point.x)},${round(point.y)}`)
    .join(" ");
  const head = arrowHead(edge.points)
    .map((point) => `${round(point.x)},${round(point.y)}`)
    .join(" ");
  const text = EDGE_LABELS[edge.id];
  const label =
    edge.label === null || text === undefined
      ? ""
      : svgText(edge.label.x, edge.label.y, text, "gedge__label");
  const state = taken ? "gedge--taken" : "";
  return `<g class="gedge ${state}" data-edge="${edge.id}"><polyline points="${points}" class="gedge__line"/><polygon points="${head}" class="gedge__head"/>${label}</g>`;
}

/** The edges and nodes of one layout, without the surrounding SVG element. */
export function graphContent(layout: GraphLayout, view: GraphView): string {
  const edges = layout.edges
    .map((edge) => edgeMarkup(edge, view.edges.includes(edge.id)))
    .join("");
  const nodes = layout.nodes
    .map((node) => nodeMarkup(node, view.nodes[node.id]))
    .join("");
  return `${edges}${nodes}`;
}

/** One orientation of the graph as an SVG. */
function graphSvg(
  layout: GraphLayout,
  view: GraphView,
  orientation: Orientation,
): string {
  return `<svg class="graph-svg graph-svg--${orientation}" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true" focusable="false">${graphContent(layout, view)}</svg>`;
}

/** A one-sentence description of the graph's state for assistive technology. */
export function graphSummary(view: GraphView): string {
  const nodes = (Object.keys(NODE_COPY) as GraphNode[])
    .map((node) => `${node} ${STATUS_WORDS[view.nodes[node]]}`)
    .join(", ");
  const loop = view.edges.includes("repair>generate")
    ? " The repair loop was taken."
    : "";
  return `Workflow graph: ${nodes}.${loop}`;
}

/**
 * The workflow graph in both orientations; CSS shows the wide one on wide screens and the narrow
 * one on phones. The text summary carries the same state for screen readers.
 */
export function workflowGraphMarkup(view: GraphView): string {
  return `${graphSvg(graphLayout("wide"), view, "wide")}${graphSvg(graphLayout("narrow"), view, "narrow")}<p class="sr-only">${graphSummary(view)}</p>`;
}
