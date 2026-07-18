import type { Diagnostic } from "../types.js";
export declare const parseDiagnostics: (input: {
    root: string;
    scanner: string;
    parser: "auto" | "eslint" | "react-doctor" | "sarif" | "tsc" | "go" | "generic";
    stdout: string;
    stderr: string;
}) => Promise<Diagnostic[]>;
