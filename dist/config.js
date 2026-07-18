import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { DEFAULT_CONFIG } from "./defaults.js";
export const CONFIG_FILE = "code-doctor.yaml";
const mergeConfig = (input) => ({
    ...DEFAULT_CONFIG,
    ...input,
    agent: { ...DEFAULT_CONFIG.agent, ...input.agent },
    graph: { ...DEFAULT_CONFIG.graph, ...input.graph },
    businessMap: { ...DEFAULT_CONFIG.businessMap, ...input.businessMap },
    audit: { ...DEFAULT_CONFIG.audit, ...input.audit },
    gitlab: { ...DEFAULT_CONFIG.gitlab, ...input.gitlab },
    limits: { ...DEFAULT_CONFIG.limits, ...input.limits },
    scanners: input.scanners ?? DEFAULT_CONFIG.scanners,
    verify: input.verify ?? DEFAULT_CONFIG.verify,
    ignore: input.ignore ?? DEFAULT_CONFIG.ignore,
});
export const loadConfig = async (root) => {
    const file = path.join(root, CONFIG_FILE);
    try {
        const content = await fs.readFile(file, "utf8");
        const parsed = YAML.parse(content);
        return mergeConfig(parsed ?? {});
    }
    catch (error) {
        if (error.code === "ENOENT")
            return DEFAULT_CONFIG;
        throw error;
    }
};
export const renderDefaultConfig = () => YAML.stringify(DEFAULT_CONFIG, { lineWidth: 100 });
//# sourceMappingURL=config.js.map