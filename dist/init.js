import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { CONFIG_FILE, renderDefaultConfig } from "./config.js";
import { pathExists } from "./utils.js";
import { initializeKnowledge } from "./knowledge.js";
const GITIGNORE_ENTRIES = [
    ".code-doctor/output/",
    ".code-doctor/cache/",
    ".code-doctor/snapshots/",
    ".code-doctor/*-task.json",
    ".code-doctor/*-prompt.md",
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
    created.push(...await initializeKnowledge(root));
    return created;
};
const MR_JOB = `code-doctor-mr-audit:
  stage: test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  variables:
    GIT_DEPTH: "0"
  before_script:
    - npm install --global @thunder-doctor/code-doctor
  script:
    - code-doctor project update --changed "$CI_MERGE_REQUEST_DIFF_BASE_SHA...$CI_COMMIT_SHA"
  artifacts:
    when: always
    expire_in: 90 days
    paths:
      - .code-doctor/output/project-report.html
      - .code-doctor/output/project-report.json
      - .code-doctor/output/project-impact.json
      - .code-doctor/output/project-audit.json
      - .code-doctor/output/
`;
const DAILY_JOB = `code-doctor-daily-audit:
  stage: test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule"'
    - if: '$CI_PIPELINE_SOURCE == "web"'
      when: manual
  variables:
    GIT_DEPTH: "0"
    CODE_DOCTOR_DAILY_LIMIT: "1"
  cache:
    key: "code-doctor-$CI_PROJECT_PATH_SLUG-$CI_DEFAULT_BRANCH"
    policy: pull-push
    paths:
      - .code-doctor/knowledge/
      - .code-doctor/output/project-build-run.json
  before_script:
    - npm install --global @thunder-doctor/code-doctor
  script:
    - code-doctor project build --all --limit "$CODE_DOCTOR_DAILY_LIMIT" || true
    - code-doctor project audit
  artifacts:
    when: always
    expire_in: 90 days
    paths:
      - .code-doctor/output/project-report.html
      - .code-doctor/output/project-report.json
      - .code-doctor/output/project-audit.json
      - .code-doctor/output/project-build-run.json
      - .code-doctor/output/
`;
const PUSH_JOB = `code-doctor-push-audit:
  stage: test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BEFORE_SHA != "0000000000000000000000000000000000000000"'
  variables:
    GIT_DEPTH: "0"
  before_script:
    - npm install --global @thunder-doctor/code-doctor
  script:
    - code-doctor project update --changed "$CI_COMMIT_BEFORE_SHA...$CI_COMMIT_SHA"
  artifacts:
    when: always
    expire_in: 90 days
    paths:
      - .code-doctor/output/project-report.html
      - .code-doctor/output/project-report.json
      - .code-doctor/output/project-impact.json
      - .code-doctor/output/project-audit.json
      - .code-doctor/output/
`;
export const installGitLabCi = async (root, mode = "both") => {
    const written = [];
    const directory = path.join(root, ".gitlab");
    const jobFile = path.join(directory, "code-doctor.yml");
    await fs.mkdir(directory, { recursive: true });
    const jobs = mode === "mr"
        ? MR_JOB
        : mode === "push"
            ? PUSH_JOB
            : mode === "daily"
                ? DAILY_JOB
                : mode === "all"
                    ? `${MR_JOB}\n${PUSH_JOB}\n${DAILY_JOB}`
                    : `${MR_JOB}\n${DAILY_JOB}`;
    await fs.writeFile(jobFile, jobs, "utf8");
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