import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { CONFIG_FILE, renderDefaultConfig } from "./config.js";
import { pathExists } from "./utils.js";
const GITIGNORE_ENTRIES = [
    ".code-doctor/output/",
    ".code-doctor/task.json",
    ".code-doctor/prompt.md",
];
export const initializeProject = async (root) => {
    const created = [];
    const configFile = path.join(root, CONFIG_FILE);
    if (!(await pathExists(configFile))) {
        await fs.writeFile(configFile, renderDefaultConfig(), "utf8");
        created.push(CONFIG_FILE);
    }
    const gitignoreFile = path.join(root, ".gitignore");
    const existing = await fs.readFile(gitignoreFile, "utf8").catch(() => "");
    const missing = GITIGNORE_ENTRIES.filter((entry) => !existing.split(/\r?\n/).includes(entry));
    if (missing.length) {
        const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
        await fs.writeFile(gitignoreFile, `${existing}${prefix}\n# Code Doctor runtime artifacts\n${missing.join("\n")}\n`, "utf8");
        created.push(".gitignore");
    }
    await fs.mkdir(path.join(root, ".code-doctor", "output"), { recursive: true });
    return created;
};
const CI_JOB = `code-doctor-daily:
  stage: test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule"'
    - if: '$CI_PIPELINE_SOURCE == "web"'
      when: manual
  variables:
    GIT_DEPTH: "0"
  before_script:
    - npm install --global "https://github.com/demon-dy/code-doctor/archive/refs/tags/v0.1.2.tar.gz"
  script:
    - code-doctor run --one --open-mr
  artifacts:
    when: always
    expire_in: 90 days
    paths:
      - .code-doctor/output/
`;
export const installGitLabCi = async (root) => {
    const written = [];
    const directory = path.join(root, ".gitlab");
    const jobFile = path.join(directory, "code-doctor.yml");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(jobFile, CI_JOB, "utf8");
    written.push(".gitlab/code-doctor.yml");
    const rootCi = path.join(root, ".gitlab-ci.yml");
    const includeLine = "  - local: '.gitlab/code-doctor.yml'";
    const existing = await fs.readFile(rootCi, "utf8").catch(() => "");
    if (!existing) {
        await fs.writeFile(rootCi, `include:\n${includeLine}\n`, "utf8");
        written.push(".gitlab-ci.yml");
    }
    else if (!existing.includes(".gitlab/code-doctor.yml")) {
        const document = YAML.parseDocument(existing);
        const current = document.get("include");
        const normalized = current === undefined
            ? []
            : Array.isArray(current)
                ? current
                : [current];
        document.set("include", [...normalized, { local: ".gitlab/code-doctor.yml" }]);
        await fs.writeFile(rootCi, document.toString(), "utf8");
        written.push(".gitlab-ci.yml");
    }
    return written;
};
//# sourceMappingURL=init.js.map