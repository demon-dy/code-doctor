import type { CodeDoctorConfig, ProjectAuditReport } from "../types.js";
export declare const auditProjectBusiness: (input: {
    root: string;
    config: CodeDoctorConfig;
    useAgent?: boolean;
}) => Promise<{
    audit: ProjectAuditReport;
    auditFile: string;
    htmlFile: string;
    reportFile: string;
}>;
