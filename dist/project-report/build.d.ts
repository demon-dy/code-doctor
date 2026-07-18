import type { ProjectBusinessReport } from "../types.js";
export declare const buildProjectReport: (root: string) => Promise<{
    report: ProjectBusinessReport;
    jsonFile: string;
    htmlFile: string;
}>;
