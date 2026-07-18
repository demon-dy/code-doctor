import type { CodeGraph } from "../types.js";
export declare const writeGraphArtifacts: (root: string, graph: CodeGraph) => Promise<{
    jsonFile: string;
    htmlFile: string;
}>;
