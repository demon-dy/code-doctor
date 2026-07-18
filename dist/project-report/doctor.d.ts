import type { AgentConfig, CodeDoctorConfig } from "../types.js";
export type ProjectDoctorStatus = "pass" | "warn" | "fail";
export interface ProjectDoctorCheck {
    id: string;
    status: ProjectDoctorStatus;
    message: string;
    suggestion?: string;
    details?: Record<string, unknown>;
}
export interface ProjectDoctorReport {
    schemaVersion: 1;
    createdAt: string;
    root: string;
    ready: boolean;
    checks: ProjectDoctorCheck[];
    languages: string[];
    knowledge: {
        discovered: number;
        mapped: number;
        reviewed: number;
    };
    agent: {
        provider: AgentConfig["provider"];
        available: boolean;
        resolvedProvider?: string;
    };
}
export declare const inspectProject: (root: string, configOverride?: CodeDoctorConfig) => Promise<ProjectDoctorReport>;
