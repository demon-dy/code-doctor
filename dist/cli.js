#!/usr/bin/env node
import path from "node:path";
import { createRequire } from "node:module";
import { Command } from "commander";
import pc from "picocolors";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { buildBusinessMap } from "./business-map/build.js";
import { checkBusinessRequirement } from "./business-map/check.js";
import { loadConfig } from "./config.js";
import { fixOneIssue } from "./fix.js";
import { analyzeCodeGraph } from "./graph/analyze.js";
import { writeGraphArtifacts } from "./graph/render.js";
import { initializeProject, installGitLabCi } from "./init.js";
import { scanFailureMessages, scanProject } from "./scan.js";
const rootOption = (command) => command.option("-C, --root <directory>", "项目根目录", process.cwd());
const resolveRoot = (value) => path.resolve(value);
const packageVersion = createRequire(import.meta.url)("../package.json").version;
const configureAgent = (config, provider) => {
    if (provider)
        config.agent.provider = provider;
};
const openLocalFile = async (file) => {
    await fs.access(file);
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", file] : [file];
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
};
const program = new Command()
    .name("code-doctor")
    .description("每天修复一个历史代码问题，并生成客户端到服务端的调用图")
    .version(packageVersion);
rootOption(program.command("init").description("初始化 code-doctor.yaml 和忽略规则"))
    .action(async (options) => {
    const root = resolveRoot(options.root);
    const files = await initializeProject(root);
    console.log(pc.green(`已初始化 ${root}`));
    for (const file of files)
        console.log(`  ${file}`);
});
rootOption(program.command("scan").description("扫描整个历史代码库并输出统一诊断"))
    .option("--json", "只输出 JSON")
    .action(async (options) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    const report = await scanProject({ root, config });
    const failures = scanFailureMessages(report);
    if (options.json)
        console.log(JSON.stringify(report));
    else {
        console.log(pc.bold(`发现 ${report.diagnostics.length} 个问题`));
        for (const diagnostic of report.diagnostics.slice(0, 20)) {
            console.log(`${diagnostic.severity === "error" ? pc.red("●") : pc.yellow("●")} ${diagnostic.rule} ${pc.dim(`${diagnostic.location.file}:${diagnostic.location.line ?? "?"}`)}`);
            console.log(`  ${diagnostic.message}`);
        }
        if (report.diagnostics.length > 20)
            console.log(pc.dim(`另有 ${report.diagnostics.length - 20} 个问题，详见 .code-doctor/output/diagnostics.json`));
        for (const failure of failures)
            console.error(pc.red(`扫描失败：${failure}`));
    }
    if (failures.length)
        process.exitCode = 1;
});
rootOption(program.command("graph").description("生成 JS/TS/Vue/Go 静态调用图和可交互 HTML"))
    .action(async (options) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    const graph = await analyzeCodeGraph({ root, config });
    const files = await writeGraphArtifacts(root, graph);
    console.log(pc.green(`调用图已生成：${files.htmlFile}`));
    console.log(pc.dim(`${graph.stats.nodes} 个节点，${graph.stats.edges} 条边，${graph.stats.endpoints} 个接口`));
});
const map = program.command("map").description("AI 业务地图：理解、展示并审计代码实际表达的业务行为");
rootOption(map.command("build").description("让 Agent 从代码和技术图生成可追溯业务地图"))
    .requiredOption("--focus <business-scenario>", "本次要理解的业务场景、页面、入口或问题")
    .option("--agent <provider>", "auto、codex、claude 或 custom")
    .action(async (options) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    const result = await buildBusinessMap({ root, config, focus: options.focus });
    console.log(pc.green(`AI 业务地图已生成：${result.htmlFile}`));
    console.log(pc.dim(`${result.map.nodes.length} 个业务节点，${result.map.edges.length} 条路径，${result.map.evidence.length} 条证据`));
    if (result.map.uncertainties.length)
        console.log(pc.yellow(`仍有 ${result.map.uncertainties.length} 个不确定项，请人工校准`));
});
rootOption(map.command("check").description("用自然语言需求检查业务地图并生成证据化结论"))
    .argument("<requirement>", "要检查的业务需求")
    .option("--agent <provider>", "auto、codex、claude 或 custom")
    .action(async (requirement, options) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    const result = await checkBusinessRequirement({ root, config, requirement });
    console.log(pc.bold(result.report.conclusion));
    for (const finding of result.report.findings) {
        const marker = finding.status === "violated" ? pc.red("●") : finding.status === "satisfied" ? pc.green("●") : pc.yellow("●");
        console.log(`${marker} ${finding.title} ${pc.dim(`${Math.round(finding.confidence * 100)}%`)}`);
        console.log(`  ${finding.conclusion}`);
    }
    console.log(pc.dim(`完整审计报告：${result.htmlFile}`));
});
rootOption(map.command("ask").description("check 的对话式别名：向当前业务地图提出问题"))
    .argument("<question>", "关于业务行为的问题或期望")
    .option("--agent <provider>", "auto、codex、claude 或 custom")
    .action(async (question, options) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    const result = await checkBusinessRequirement({ root, config, requirement: question });
    console.log(result.report.conclusion);
    console.log(pc.dim(`证据化回答：${result.htmlFile}`));
});
rootOption(map.command("open").description("打开最近生成的 AI 业务地图或审计报告"))
    .option("--report", "打开审计报告而不是业务地图", false)
    .action(async (options) => {
    const root = resolveRoot(options.root);
    const file = path.join(root, ".code-doctor", "output", options.report ? "audit-report.html" : "business-map.html");
    await openLocalFile(file);
    console.log(file);
});
const addFixOptions = (command) => rootOption(command)
    .option("--one", "每次只修复一个问题", true)
    .option("--agent <provider>", "auto、codex、claude 或 custom")
    .option("--open-mr", "修复通过后推送并创建 GitLab MR", false);
addFixOptions(program.command("fix").description("选择一个历史问题并交给 Agent 修复"))
    .action(async (options) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
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
    if (record.mergeRequestUrl)
        console.log(record.mergeRequestUrl);
});
addFixOptions(program.command("run").description("扫描、画图、修复一个问题并可创建 MR"))
    .action(async (options) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    if (config.graph.enabled) {
        const graph = await analyzeCodeGraph({ root, config });
        await writeGraphArtifacts(root, graph);
        console.log(pc.dim(`调用图：${graph.stats.nodes} 个节点，${graph.stats.edges} 条边`));
    }
    const record = await fixOneIssue({ root, config, openMergeRequest: options.openMr });
    if (record.error) {
        console.error(pc.red(`修复失败：${record.error}`));
        process.exitCode = 1;
    }
    else if (!record.selectedDiagnostic)
        console.log(pc.green("没有待处理问题"));
    else {
        console.log(pc.green(`已修复 ${record.selectedDiagnostic.rule}`));
        if (record.mergeRequestUrl)
            console.log(record.mergeRequestUrl);
    }
});
const ci = program.command("ci").description("安装 CI 集成");
rootOption(ci.command("install").description("写入 GitLab CI 定时任务模板"))
    .action(async (options) => {
    const files = await installGitLabCi(resolveRoot(options.root));
    console.log(pc.green("GitLab CI 模板已安装"));
    for (const file of files)
        console.log(`  ${file}`);
});
program.parseAsync().catch((error) => {
    console.error(pc.red(error.stack ?? String(error)));
    process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map