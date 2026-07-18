#!/usr/bin/env node
import path from "node:path";
import { createRequire } from "node:module";
import { Command } from "commander";
import pc from "picocolors";
import { loadConfig } from "./config.js";
import { fixOneIssue } from "./fix.js";
import { analyzeCodeGraph } from "./graph/analyze.js";
import { writeGraphArtifacts } from "./graph/render.js";
import { initializeProject, installGitLabCi } from "./init.js";
import { scanFailureMessages, scanProject } from "./scan.js";

const rootOption = (command: Command): Command =>
  command.option("-C, --root <directory>", "项目根目录", process.cwd());

const resolveRoot = (value: string): string => path.resolve(value);
const packageVersion = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

const program = new Command()
  .name("code-doctor")
  .description("每天修复一个历史代码问题，并生成客户端到服务端的调用图")
  .version(packageVersion);

rootOption(program.command("init").description("初始化 code-doctor.yaml 和忽略规则"))
  .action(async (options: { root: string }) => {
    const root = resolveRoot(options.root);
    const files = await initializeProject(root);
    console.log(pc.green(`已初始化 ${root}`));
    for (const file of files) console.log(`  ${file}`);
  });

rootOption(program.command("scan").description("扫描整个历史代码库并输出统一诊断"))
  .option("--json", "只输出 JSON")
  .action(async (options: { root: string; json?: boolean }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    const report = await scanProject({ root, config });
    const failures = scanFailureMessages(report);
    if (options.json) console.log(JSON.stringify(report));
    else {
      console.log(pc.bold(`发现 ${report.diagnostics.length} 个问题`));
      for (const diagnostic of report.diagnostics.slice(0, 20)) {
        console.log(`${diagnostic.severity === "error" ? pc.red("●") : pc.yellow("●")} ${diagnostic.rule} ${pc.dim(`${diagnostic.location.file}:${diagnostic.location.line ?? "?"}`)}`);
        console.log(`  ${diagnostic.message}`);
      }
      if (report.diagnostics.length > 20) console.log(pc.dim(`另有 ${report.diagnostics.length - 20} 个问题，详见 .code-doctor/output/diagnostics.json`));
      for (const failure of failures) console.error(pc.red(`扫描失败：${failure}`));
    }
    if (failures.length) process.exitCode = 1;
  });

rootOption(program.command("graph").description("生成 JS/TS/Vue/Go 静态调用图和可交互 HTML"))
  .action(async (options: { root: string }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    const graph = await analyzeCodeGraph({ root, config });
    const files = await writeGraphArtifacts(root, graph);
    console.log(pc.green(`调用图已生成：${files.htmlFile}`));
    console.log(pc.dim(`${graph.stats.nodes} 个节点，${graph.stats.edges} 条边，${graph.stats.endpoints} 个接口`));
  });

const addFixOptions = (command: Command): Command =>
  rootOption(command)
    .option("--one", "每次只修复一个问题", true)
    .option("--agent <provider>", "auto、codex、claude 或 custom")
    .option("--open-mr", "修复通过后推送并创建 GitLab MR", false);

addFixOptions(program.command("fix").description("选择一个历史问题并交给 Agent 修复"))
  .action(async (options: { root: string; agent?: string; openMr: boolean }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    if (options.agent) config.agent.provider = options.agent as typeof config.agent.provider;
    const record = await fixOneIssue({ root, config, openMergeRequest: options.openMr });
    if (record.error) {
      console.error(pc.red(`修复失败：${record.error}`));
      process.exitCode = 1;
      return;
    }
    if (!record.selectedDiagnostic) {
      console.log(pc.green("没有待处理问题"));
      return;
    }
    console.log(pc.green(`已修复 ${record.selectedDiagnostic.rule}`));
    if (record.mergeRequestUrl) console.log(record.mergeRequestUrl);
  });

addFixOptions(program.command("run").description("扫描、画图、修复一个问题并可创建 MR"))
  .action(async (options: { root: string; agent?: string; openMr: boolean }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    if (options.agent) config.agent.provider = options.agent as typeof config.agent.provider;
    if (config.graph.enabled) {
      const graph = await analyzeCodeGraph({ root, config });
      await writeGraphArtifacts(root, graph);
      console.log(pc.dim(`调用图：${graph.stats.nodes} 个节点，${graph.stats.edges} 条边`));
    }
    const record = await fixOneIssue({ root, config, openMergeRequest: options.openMr });
    if (record.error) {
      console.error(pc.red(`修复失败：${record.error}`));
      process.exitCode = 1;
    } else if (!record.selectedDiagnostic) console.log(pc.green("没有待处理问题"));
    else {
      console.log(pc.green(`已修复 ${record.selectedDiagnostic.rule}`));
      if (record.mergeRequestUrl) console.log(record.mergeRequestUrl);
    }
  });

const ci = program.command("ci").description("安装 CI 集成");
rootOption(ci.command("install").description("写入 GitLab CI 定时任务模板"))
  .action(async (options: { root: string }) => {
    const files = await installGitLabCi(resolveRoot(options.root));
    console.log(pc.green("GitLab CI 模板已安装"));
    for (const file of files) console.log(`  ${file}`);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(pc.red((error as Error).stack ?? String(error)));
  process.exitCode = 1;
});
