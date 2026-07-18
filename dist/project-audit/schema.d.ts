import type { ProjectAuditFinding, ProjectAuditReport, ProjectBusinessReport } from "../types.js";
export declare const finalizeProjectAgentAudit: (input: {
    candidate: unknown;
    project: ProjectBusinessReport;
}) => {
    findings: ProjectAuditFinding[];
    conclusion: string;
    unansweredQuestions: string[];
};
export declare const summarizeProjectAudit: (report: Omit<ProjectAuditReport, "summary">) => ProjectAuditReport["summary"];
