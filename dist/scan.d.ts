import type { CodeDoctorConfig, Diagnostic, ScanReport } from "./types.js";
export declare const scanProject: (input: {
    root: string;
    config: CodeDoctorConfig;
    writeReport?: boolean;
}) => Promise<ScanReport>;
export declare const scanFailureMessages: (report: ScanReport) => string[];
export declare const assertScanSucceeded: (report: ScanReport) => void;
export declare const selectOneDiagnostic: (report: ScanReport) => Diagnostic | undefined;
