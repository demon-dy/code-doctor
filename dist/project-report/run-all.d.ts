import { buildBusinessMap } from "../business-map/build.js";
import { discoverBusinessScenarios } from "../business-map/discover.js";
import { listScenarios } from "../knowledge.js";
import type { CodeDoctorConfig, KnowledgeAtlasEntry, ProjectBuildRunState, ProjectBusinessReport } from "../types.js";
import { buildProjectReport } from "./build.js";
/** 依赖优先的稳定拓扑序；循环依赖无法满足时仍按优先级稳定处理，避免整批停摆。 */
export declare const orderProjectScenarios: (entries: KnowledgeAtlasEntry[]) => KnowledgeAtlasEntry[];
interface ProjectBuildDependencies {
    list: typeof listScenarios;
    discover: typeof discoverBusinessScenarios;
    buildMap: typeof buildBusinessMap;
    hasMap: (root: string, id: string) => Promise<boolean>;
    buildReport: typeof buildProjectReport;
    now: () => string;
}
export declare const runAllProjectScenarios: (input: {
    root: string;
    config: CodeDoctorConfig;
    refresh?: boolean;
    limit?: number;
}, overrides?: Partial<ProjectBuildDependencies>) => Promise<{
    state: ProjectBuildRunState;
    stateFile: string;
    report: ProjectBusinessReport;
    htmlFile: string;
    attempted: number;
    completed: number;
    failed: number;
}>;
export {};
