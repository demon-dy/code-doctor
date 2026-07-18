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
    expect(await fs.readFile(path.join(root, "code-doctor.yaml"), "utf8")).toContain("version: 1");
  });

  it("把 GitLab CI include 合并进已有配置", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-ci-"));
    directories.push(root);
    await fs.writeFile(path.join(root, ".gitlab-ci.yml"), "include:\n  - local: '.gitlab/base.yml'\n", "utf8");
    await installGitLabCi(root);
    const ci = await fs.readFile(path.join(root, ".gitlab-ci.yml"), "utf8");
    expect(ci).toContain(".gitlab/base.yml");
    expect(ci).toContain(".gitlab/code-doctor.yml");
  });
});
