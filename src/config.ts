import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { CodeDoctorConfig } from "./types.js";

export const CONFIG_FILE = "code-doctor.yaml";

const mergeConfig = (input: Partial<CodeDoctorConfig>): CodeDoctorConfig => ({
  ...DEFAULT_CONFIG,
  ...input,
  agent: { ...DEFAULT_CONFIG.agent, ...input.agent },
  graph: { ...DEFAULT_CONFIG.graph, ...input.graph },
  gitlab: { ...DEFAULT_CONFIG.gitlab, ...input.gitlab },
  limits: { ...DEFAULT_CONFIG.limits, ...input.limits },
  scanners: input.scanners ?? DEFAULT_CONFIG.scanners,
  verify: input.verify ?? DEFAULT_CONFIG.verify,
  ignore: input.ignore ?? DEFAULT_CONFIG.ignore,
});

export const loadConfig = async (root: string): Promise<CodeDoctorConfig> => {
  const file = path.join(root, CONFIG_FILE);
  try {
    const content = await fs.readFile(file, "utf8");
    const parsed = YAML.parse(content) as Partial<CodeDoctorConfig> | null;
    return mergeConfig(parsed ?? {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_CONFIG;
    throw error;
  }
};

export const renderDefaultConfig = (): string =>
  YAML.stringify(DEFAULT_CONFIG, { lineWidth: 100 });
