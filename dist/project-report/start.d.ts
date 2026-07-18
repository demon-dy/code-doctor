import type { CodeDoctorConfig, ProjectAuditReport, ProjectBusinessReport } from "../types.js";
import { type ProjectDoctorReport } from "./doctor.js";
export interface ProjectStartResult {
    status: "completed" | "partial" | "degraded";
    initializedFiles: string[];
    doctor: ProjectDoctorReport;
    attempted: number;
    completed: number;
    failed: number;
    audit?: ProjectAuditReport;
    report: ProjectBusinessReport;
    htmlFile: string;
    messages: string[];
}
export declare const startProject: (input: {
    root: string;
    config: CodeDoctorConfig;
    limit?: number;
    audit?: boolean;
}) => Promise<ProjectStartResult>;
