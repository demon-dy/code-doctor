import type { BusinessEdge } from "../types.js";
export type MapFocusMode = "full" | "upstream" | "downstream";
export type MapSelection = {
    type: "node" | "edge";
    id: string;
};
export interface FocusedSubgraph {
    nodes: Set<string>;
    edges: Set<string>;
}
export declare const collectFocusedSubgraph: (businessEdges: BusinessEdge[], selection: MapSelection | undefined, mode: MapFocusMode) => FocusedSubgraph | undefined;
