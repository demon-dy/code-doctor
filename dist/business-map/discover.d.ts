import type { CodeDoctorConfig, KnowledgeAtlasEntry } from "../types.js";
export declare const discoverBusinessScenarios: (input: {
    root: string;
    config: CodeDoctorConfig;
}) => Promise<{
    projectSummary: string;
    scenarios: KnowledgeAtlasEntry[];
    candidateFile: string;
}>;
