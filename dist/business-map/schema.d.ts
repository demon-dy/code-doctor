import type { AgentRunResult, BusinessAuditReport, BusinessMap, BusinessMapConfig } from "../types.js";
export declare const finalizeBusinessMap: (input: {
    candidate: unknown;
    root: string;
    focus: string;
    config: BusinessMapConfig;
    agent: AgentRunResult;
}) => Promise<BusinessMap>;
export declare const finalizeAuditReport: (input: {
    candidate: unknown;
    root: string;
    requirement: string;
    map: BusinessMap;
    agent: AgentRunResult;
}) => BusinessAuditReport;
