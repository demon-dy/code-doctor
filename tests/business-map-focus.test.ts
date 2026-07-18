import { describe, expect, it } from "vitest";
import { collectFocusedSubgraph } from "../src/business-map/focus.js";
import type { BusinessEdge } from "../src/types.js";

const edge = (id: string, from: string, to: string): BusinessEdge => ({
  id,
  from,
  to,
  status: "fact",
  confidence: 1,
  evidenceIds: ["source"],
});

const edges = [
  edge("a-b", "a", "b"),
  edge("b-c", "b", "c"),
  edge("b-d", "b", "d"),
  edge("c-b", "c", "b"),
  edge("d-e", "d", "e"),
];

describe("业务地图链路聚焦", () => {
  it("选中节点时可以分别聚焦完整、上游和下游链路", () => {
    const full = collectFocusedSubgraph(edges, { type: "node", id: "d" }, "full")!;
    expect([...full.nodes].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect([...full.edges].sort()).toEqual(["a-b", "b-c", "b-d", "c-b", "d-e"]);

    const upstream = collectFocusedSubgraph(edges, { type: "node", id: "d" }, "upstream")!;
    expect([...upstream.nodes].sort()).toEqual(["a", "b", "c", "d"]);
    expect(upstream.edges.has("d-e")).toBe(false);

    const downstream = collectFocusedSubgraph(edges, { type: "node", id: "d" }, "downstream")!;
    expect([...downstream.nodes].sort()).toEqual(["d", "e"]);
    expect([...downstream.edges]).toEqual(["d-e"]);
  });

  it("选中边时保留该边并连接其上游和下游", () => {
    const focused = collectFocusedSubgraph(edges, { type: "edge", id: "b-d" }, "full")!;
    expect([...focused.nodes].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(focused.edges.has("b-d")).toBe(true);
    expect(focused.edges.has("d-e")).toBe(true);
  });

  it("有循环时可以终止遍历", () => {
    const focused = collectFocusedSubgraph(edges, { type: "node", id: "b" }, "downstream")!;
    expect([...focused.nodes].sort()).toEqual(["b", "c", "d", "e"]);
    expect(focused.edges.size).toBe(4);
  });
});
