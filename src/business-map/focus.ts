import type { BusinessEdge } from "../types.js";

export type MapFocusMode = "full" | "upstream" | "downstream";
export type MapSelection = { type: "node" | "edge"; id: string };

export interface FocusedSubgraph {
  nodes: Set<string>;
  edges: Set<string>;
}

export const collectFocusedSubgraph = (
  businessEdges: BusinessEdge[],
  selection: MapSelection | undefined,
  mode: MapFocusMode,
): FocusedSubgraph | undefined => {
  if (!selection) return undefined;
  const nodes = new Set<string>();
  const edges = new Set<string>();
  const outgoing = new Map<string, BusinessEdge[]>();
  const incoming = new Map<string, BusinessEdge[]>();
  for (const edge of businessEdges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  }

  const walk = (
    start: string,
    adjacency: Map<string, BusinessEdge[]>,
    next: (edge: BusinessEdge) => string,
  ): void => {
    const visited = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      nodes.add(current);
      for (const edge of adjacency.get(current) ?? []) {
        edges.add(edge.id);
        const target = next(edge);
        nodes.add(target);
        if (!visited.has(target)) queue.push(target);
      }
    }
  };

  if (selection.type === "node") {
    nodes.add(selection.id);
    if (mode !== "downstream") walk(selection.id, incoming, (edge) => edge.from);
    if (mode !== "upstream") walk(selection.id, outgoing, (edge) => edge.to);
    return { nodes, edges };
  }

  const selectedEdge = businessEdges.find((edge) => edge.id === selection.id);
  if (!selectedEdge) return { nodes, edges };
  nodes.add(selectedEdge.from);
  nodes.add(selectedEdge.to);
  edges.add(selectedEdge.id);
  if (mode !== "downstream") walk(selectedEdge.from, incoming, (edge) => edge.from);
  if (mode !== "upstream") walk(selectedEdge.to, outgoing, (edge) => edge.to);
  return { nodes, edges };
};
