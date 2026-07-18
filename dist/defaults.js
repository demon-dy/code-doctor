export const DEFAULT_CONFIG = {
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
        include: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.mts",
            "**/*.cts",
            "**/*.js",
            "**/*.jsx",
            "**/*.mjs",
            "**/*.cjs",
            "**/*.vue",
            "**/*.go",
        ],
        exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
            "**/coverage/**",
            "**/vendor/**",
            "**/.git/**",
        ],
    },
    businessMap: {
        enabled: true,
        maxNodes: 80,
        maxEvidence: 200,
    },
    audit: {
        maxScenariosPerRun: 3,
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
//# sourceMappingURL=defaults.js.map