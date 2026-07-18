import type { CodeDoctorConfig, CodeGraph } from "../types.js";
export declare const analyzeCodeGraph: (input: {
    root: string;
    config: CodeDoctorConfig;
}) => Promise<CodeGraph>;
