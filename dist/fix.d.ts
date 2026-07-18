import type { CodeDoctorConfig, DoctorRunRecord } from "./types.js";
export declare const fixOneIssue: (input: {
    root: string;
    config: CodeDoctorConfig;
    openMergeRequest: boolean;
}) => Promise<DoctorRunRecord>;
