import type { BusinessMap, KnowledgeAtlas, KnowledgeAtlasEntry, KnowledgeRule, KnowledgeScenarioRecord, TakeoverState } from "./types.js";
export declare const knowledgeDirectory: (root: string) => string;
export declare const initializeKnowledge: (root: string) => Promise<string[]>;
export declare const scenarioIdFromFocus: (focus: string) => string;
export declare const saveScenarioCandidate: (input: {
    root: string;
    map: BusinessMap;
    id?: string;
}) => Promise<{
    id: string;
    file: string;
}>;
export declare const loadScenario: (root: string, id: string, preferCandidate?: boolean) => Promise<KnowledgeScenarioRecord>;
export declare const listScenarios: (root: string) => Promise<KnowledgeAtlasEntry[]>;
export declare const listRules: (root: string, scenarioId?: string) => Promise<KnowledgeRule[]>;
export declare const addConfirmedRule: (input: {
    root: string;
    id: string;
    scenarioId: string;
    statement: string;
    reviewer: string;
}) => Promise<KnowledgeRule>;
export declare const saveDiscoveredScenarios: (root: string, entries: KnowledgeAtlasEntry[]) => Promise<KnowledgeAtlas>;
export declare const saveProjectSummaryCandidate: (root: string, summary: string) => Promise<string>;
export declare const confirmScenario: (input: {
    root: string;
    id: string;
    reviewer: string;
}) => Promise<KnowledgeScenarioRecord>;
export declare const startTakeover: (root: string, owner?: string) => Promise<TakeoverState>;
export declare const nextTakeoverScenario: (root: string) => Promise<TakeoverState["scenarios"][number] | undefined>;
export declare const confirmTakeoverScenario: (input: {
    root: string;
    id: string;
    owner: string;
}) => Promise<TakeoverState>;
export declare const takeoverProgress: (root: string) => Promise<{
    state: TakeoverState;
    total: number;
    understood: number;
    percent: number;
}>;
