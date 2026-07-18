import type { CodeDoctorConfig } from "./types.js";
export declare const CONFIG_FILE = "code-doctor.yaml";
export declare const loadConfig: (root: string) => Promise<CodeDoctorConfig>;
export declare const renderDefaultConfig: () => string;
