import { describe, expect, it } from "vitest";
import { type NodeBox, type Point, arrowHead, graphLayout } from "./graph";
import { GRAPH_EDGES, GRAPH_NODES } from "./replay-state";

/** Whether a point lies on the border of a node box (within half a unit). */
function onBorder(point: Point, node: NodeBox): boolean {
  const left = node.cx - node.width / 2;
  const right = node.cx + node.width / 2;
  const top = node.cy - node.height / 2;
  const bottom = node.cy + node.height / 2;
  const inside =
    point.x >= left - 0.5 &&
    point.x <= right + 0.5 &&
    point.y >= top - 0.5 &&
    point.y <= bottom + 0.5;
  const onEdge =
    Math.abs(point.x - left) < 0.5 ||
    Math.abs(point.x - right) < 0.5 ||
    Math.abs(point.y - top) < 0.5 ||
    Math.abs(point.y - bottom) < 0.5;
  return inside && onEdge;
}

describe.each(["wide", "narrow"] as const)("%s graph layout", (orientation) => {
  const layout = graphLayout(orientation);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  it("draws every node and every edge once", () => {
    expect(layout.nodes.map((node) => node.id).toSorted()).toEqual(
      [...GRAPH_NODES].toSorted(),
    );
    expect(layout.edges.map((edge) => edge.id).toSorted()).toEqual(
      [...GRAPH_EDGES].toSorted(),
    );
  });

  it("keeps every node inside the view box", () => {
    for (const node of layout.nodes) {
      expect(node.cx - node.width / 2).toBeGreaterThanOrEqual(0);
      expect(node.cx + node.width / 2).toBeLessThanOrEqual(layout.width);
      expect(node.cy - node.height / 2).toBeGreaterThanOrEqual(0);
      expect(node.cy + node.height / 2).toBeLessThanOrEqual(layout.height);
    }
  });

  it("ends every edge on its target node's border", () => {
    for (const edge of layout.edges) {
      const target = byId.get(edge.id.split(">")[1] as NodeBox["id"]);
      const end = edge.points.at(-1);
      expect(target && end && onBorder(end, target), edge.id).toBe(true);
    }
  });
});

describe("arrowHead", () => {
  it("points along the last segment", () => {
    const head = arrowHead([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(head[0]).toEqual({ x: 100, y: 0 });
    expect(head[1]?.x).toBeLessThan(100);
    expect((head[1]?.y ?? 0) * (head[2]?.y ?? 0)).toBeLessThan(0);
  });

  it("returns nothing for a degenerate line", () => {
    expect(arrowHead([{ x: 1, y: 1 }])).toEqual([]);
    expect(
      arrowHead([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([]);
  });
});
