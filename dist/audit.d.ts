import type { BusinessAuditReport, CodeDoctorConfig } from "./types.js";
export interface AuditExecution {
    mode: "changed" | "deep";
    createdAt: string;
    range?: string;
    changedFiles: string[];
    uncoveredFiles: string[];
    selectedScenarios: Array<{
        id: string;
        title: string;
        status: string;
    }>;
    deferredScenarios: Array<{
        id: string;
        title: string;
        status: string;
    }>;
    reports: Array<{
        scenarioId: string;
        report: BusinessAuditReport;
        reportFile: string;
        htmlFile: string;
    }>;
}
export declare const auditChanged: (input: {
    root: string;
    config: CodeDoctorConfig;
    range: string;
    one?: boolean;
}) => Promise<AuditExecution>;
export declare const auditDeep: (input: {
    root: string;
    config: CodeDoctorConfig;
    one?: boolean;
}) => Promise<AuditExecution>;
