import type { BusinessMap, CodeDoctorConfig } from "../types.js";
export declare const buildBusinessMap: (input: {
    root: string;
    config: CodeDoctorConfig;
    focus: string;
    scenarioId?: string;
    persist?: boolean;
}) => Promise<{
    map: BusinessMap;
    jsonFile: string;
    htmlFile: string;
    knowledge?: {
        id: string;
        file: string;
    };
}>;
