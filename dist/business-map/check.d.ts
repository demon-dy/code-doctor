import type { BusinessAuditReport, BusinessMap, CodeDoctorConfig } from "../types.js";
export declare const checkBusinessRequirement: (input: {
    root: string;
    config: CodeDoctorConfig;
    requirement: string;
    map?: BusinessMap;
    artifactId?: string;
}) => Promise<{
    report: BusinessAuditReport;
    reportFile: string;
    htmlFile: string;
}>;
