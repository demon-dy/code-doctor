import type { CodeDoctorConfig } from "./types.js";

export const DEFAULT_CONFIG: CodeDoctorConfig = {
  version: 1,
  scanners: [
    {
      name: "auto",
      command: "auto",
      parser: "auto",
      enabled: true,
      timeoutMs: 300_000,
    },
  ],
  agent: {
    provider: "auto",
    timeoutMs: 900_000,
  },
  verify: [],
  graph: {
    enabled: true,
    include: ["**/*.ts", "**/*.tsx", "**/*.go"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/vendor/**",
      "**/.git/**",
    ],
  },
  gitlab: {
    enabled: true,
    remote: "origin",
    targetBranch: "main",
    labels: ["code-doctor"],
  },
  limits: {
    maxChangedFiles: 6,
    maxChangedLines: 250,
  },
  ignore: [],
};
