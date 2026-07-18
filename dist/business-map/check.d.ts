import type { BusinessAuditReport, CodeDoctorConfig } from "../types.js";
export declare const checkBusinessRequirement: (input: {
    root: string;
    config: CodeDoctorConfig;
    requirement: string;
}) => Promise<{
    report: BusinessAuditReport;
    reportFile: string;
    htmlFile: string;
}>;
