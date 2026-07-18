import { buildBusinessMap } from "../business-map/build.js";
import type { CodeDoctorConfig, ProjectBusinessReport, ProjectImpactChangeStatus, ProjectImpactChangedFile, ProjectImpactReport, ProjectImpactScenario } from "../types.js";
import { auditProjectBusiness } from "../project-audit/audit.js";
import { buildProjectReport } from "./build.js";
export interface GitChangedPath {
    path: string;
    previousPath?: string;
    status: ProjectImpactChangeStatus;
}
export declare const validateGitRange: (value: string) => string;
export declare const rangeFromBase: (value: string) => string;
export declare const parseGitNameStatus: (stdout: string) => GitChangedPath[];
export declare const readGitChanges: (root: string, unsafeRange: string) => Promise<GitChangedPath[]>;
export declare const isGlobalProjectFile: (file: string) => boolean;
export declare const analyzeProjectImpact: (input: {
    changes: GitChangedPath[];
    project: ProjectBusinessReport;
    config: CodeDoctorConfig;
}) => {
    changedFiles: ProjectImpactChangedFile[];
    impactedScenarios: Array<Omit<ProjectImpactScenario, "status" | "attempts">>;
    unchangedScenarioIds: string[];
    unattributedFiles: string[];
    unknownBoundaries: string[];
};
declare const currentCommit: (root: string) => Promise<string | undefined>;
interface UpdateDependencies {
    readChanges: typeof readGitChanges;
    buildReport: typeof buildProjectReport;
    buildMap: typeof buildBusinessMap;
    audit: typeof auditProjectBusiness;
    commit: typeof currentCommit;
    now: () => string;
}
export declare const updateProjectFromGit: (input: {
    root: string;
    config: CodeDoctorConfig;
    range: string;
    limit?: number;
    useAgent?: boolean;
}, overrides?: Partial<UpdateDependencies>) => Promise<{
    impact: ProjectImpactReport;
    impactFile: string;
    report: ProjectBusinessReport;
    htmlFile: string;
}>;
export {};
