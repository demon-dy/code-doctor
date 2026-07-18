import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeProject, installGitLabCi } from "../src/init.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("project initialization", () => {
  it("初始化配置并保持重复执行幂等", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-init-"));
    directories.push(root);
    await initializeProject(root);
    await initializeProject(root);
    const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    expect(gitignore.match(/\.code-doctor\/output\//g)).toHaveLength(1);
    expect(gitignore.match(/\.code-doctor\/cache\//g)).toHaveLength(1);
    expect(await fs.readFile(path.join(root, "code-doctor.yaml"), "utf8")).toContain("version: 1");
    expect(await fs.readFile(path.join(root, ".code-doctor", "knowledge", "atlas.yaml"), "utf8")).toContain("scenarios: []");
    expect(await fs.readFile(path.join(root, ".code-doctor", "knowledge", "takeover.yaml"), "utf8")).toContain("scenarios: []");
  });

  it("把 GitLab CI include 合并进已有配置", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-ci-"));
    directories.push(root);
    await fs.writeFile(path.join(root, ".gitlab-ci.yml"), "include:\n  - local: '.gitlab/base.yml'\n", "utf8");
    await installGitLabCi(root);
    const ci = await fs.readFile(path.join(root, ".gitlab-ci.yml"), "utf8");
    expect(ci).toContain(".gitlab/base.yml");
    expect(ci).toContain(".gitlab/code-doctor.yml");
    const jobs = await fs.readFile(path.join(root, ".gitlab", "code-doctor.yml"), "utf8");
    expect(jobs).toContain("code-doctor-mr-audit");
    expect(jobs).toContain("code-doctor-daily-audit");
    expect(jobs).toContain("project update --changed");
    expect(jobs).toContain("project build --all --limit");
    expect(jobs).toContain("project audit");
    expect(jobs).toContain("policy: pull-push");
    expect(jobs).toContain(".code-doctor/knowledge/");
    expect(jobs).toContain(".code-doctor/output/project-build-run.json");
    expect(jobs).toContain(".code-doctor/output/project-report.html");
    expect(jobs).not.toContain("audit --deep --one");
    await installGitLabCi(root, "push");
    const pushJob = await fs.readFile(path.join(root, ".gitlab", "code-doctor.yml"), "utf8");
    expect(pushJob).toContain("code-doctor-push-audit");
    expect(pushJob).toContain("CI_COMMIT_BEFORE_SHA...$CI_COMMIT_SHA");
    expect(pushJob).not.toContain("code-doctor-daily-audit");
  });
});
