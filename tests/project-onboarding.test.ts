import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import { inspectProject } from "../src/project-report/doctor.js";
import { startProject } from "../src/project-report/start.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))));

describe("project onboarding", () => {
  it("doctor 对无 Git 的 custom Agent 项目给出机器可读能力结论", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-doctor-"));
    directories.push(root);
    await fs.writeFile(path.join(root, "main.ts"), "export const run = () => 'ok';\n", "utf8");
    const report = await inspectProject(root, { ...DEFAULT_CONFIG, agent: { provider: "custom", command: "node agent.mjs" } });
    expect(report.languages).toContain("TypeScript");
    expect(report.agent).toMatchObject({ provider: "custom", available: true, resolvedProvider: "custom" });
    expect(report.checks.find((check) => check.id === "git")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "config")?.suggestion).toContain("project start");
  });

  it("空项目诚实降级且仍生成唯一项目 HTML", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-empty-"));
    directories.push(root);
    const result = await startProject({ root, config: DEFAULT_CONFIG, limit: 1 });
    expect(result.status).toBe("degraded");
    expect(result.attempted).toBe(0);
    expect(result.messages.join("\n")).toContain("未检测到支持的业务源码");
    expect(await fs.readFile(result.htmlFile, "utf8")).toContain("已发现并建图的业务，而不是宣称穷尽所有业务");
    expect(await fs.stat(path.join(root, ".code-doctor", "output", "project-report.html"))).toBeTruthy();
  });

  it("业务地图被配置关闭时不会在一键入口中途失败", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-disabled-"));
    directories.push(root);
    await fs.writeFile(path.join(root, "main.ts"), "export const run = () => true;\n", "utf8");
    const config = {
      ...DEFAULT_CONFIG,
      agent: { provider: "custom" as const, command: "node ignored.mjs" },
      businessMap: { ...DEFAULT_CONFIG.businessMap, enabled: false },
    };

    const result = await startProject({ root, config, limit: 1 });

    expect(result.status).toBe("degraded");
    expect(result.attempted).toBe(0);
    expect(result.messages.join("\n")).toContain("businessMap.enabled=false");
    expect(result.doctor.ready).toBe(false);
  });
});
