import type { BusinessMap, CodeDoctorConfig } from "../types.js";
export declare const buildBusinessMap: (input: {
    root: string;
    config: CodeDoctorConfig;
    focus: string;
}) => Promise<{
    map: BusinessMap;
    jsonFile: string;
    htmlFile: string;
}>;
