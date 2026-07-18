import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const packageVersion = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).version;
// 必须放在源码仓库外，避免 Node 向上解析到开发工作区的 node_modules，造成 tarball
// 缺依赖却仍然通过的假阳性。
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-pack-e2e-"));
const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { cwd: options.cwd ?? root, env: { ...process.env, ...options.env }, encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) throw new Error(`${file} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};

const agentSource = `
import fs from "node:fs";
const prompt = process.env.CODE_DOCTOR_PROMPT_FILE;
const taskFile = prompt.replace(/-prompt\\.md$/, "-task.json");
const task = JSON.parse(fs.readFileSync(taskFile, "utf8"));
if (task.kind === "business-scenario-discovery") {
  const evidence = fs.existsSync("src/main.ts") ? "src/main.ts" : fs.existsSync("src/main.js") ? "src/main.js" : "main.go";
  fs.writeFileSync(task.candidateFile, JSON.stringify({ projectSummary: "从入口执行核心业务并返回结果。", scenarios: [{ id: "core-flow", title: "核心业务流程", focus: "用户触发核心流程并获得结果", summary: "覆盖项目主入口到业务结果。", priority: "critical", dependsOn: [], evidenceFiles: [evidence] }] }));
} else if (task.kind === "business-map-build") {
  const evidence = fs.existsSync("src/main.ts") ? "src/main.ts" : fs.existsSync("src/main.js") ? "src/main.js" : "main.go";
  fs.writeFileSync(task.candidateFile, JSON.stringify({ title: "核心业务流程", summary: "用户触发后系统处理并返回结果。", chapters: [{ id: "c1", title: "触发与处理", summary: "从触发到结果。", nodeIds: ["entry", "action", "result"] }], nodes: [{ id: "entry", label: "用户触发", kind: "scenario", summary: "用户进入核心流程。", status: "fact", evidenceIds: ["source"] }, { id: "action", label: "系统处理", kind: "action", summary: "系统执行核心处理。", status: "fact", evidenceIds: ["source"] }, { id: "result", label: "返回结果", kind: "outcome", summary: "用户获得业务结果。", status: "fact", evidenceIds: ["source"] }], edges: [{ id: "e1", from: "entry", to: "action", label: "触发", status: "fact", confidence: 1, evidenceIds: ["source"] }, { id: "e2", from: "action", to: "result", label: "完成", status: "fact", confidence: 1, evidenceIds: ["source"] }], evidence: [{ id: "source", kind: "source", description: "项目主入口实现核心流程。", location: { file: evidence, line: 1 }, confidence: 1 }], uncertainties: [] }));
} else if (task.kind === "project-business-logic-audit") {
  fs.writeFileSync(task.candidateFile, JSON.stringify({ conclusion: "当前证据未发现跨场景业务风险。", findings: [], unansweredQuestions: [] }));
} else process.exit(2);
`;

const makeFixture = async (name, files) => {
  const directory = path.join(workspace, name);
  await fs.mkdir(directory, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(directory, relative)), { recursive: true });
    await fs.writeFile(path.join(directory, relative), content, "utf8");
  }
  await fs.writeFile(path.join(directory, "agent.mjs"), agentSource, "utf8");
  await fs.writeFile(path.join(directory, "code-doctor.yaml"), `version: 1\nagent:\n  provider: custom\n  command: node agent.mjs\n`, "utf8");
  return directory;
};

try {
  const dryRun = JSON.parse(run("npm", ["pack", "--json", "--dry-run"]));
  const packedPaths = dryRun[0].files.map((file) => file.path);
  assert(packedPaths.some((file) => file === "dist/cli.js"), "tarball must include dist/cli.js");
  assert(!packedPaths.some((file) => file.startsWith("src/") || file.startsWith("tests/")), "tarball must not include src/tests");

  const packJson = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", workspace]));
  const tarball = path.join(workspace, packJson[0].filename);
  const extracted = path.join(workspace, "installed");
  await fs.mkdir(extracted);
  await fs.writeFile(path.join(extracted, "package.json"), JSON.stringify({ private: true }), "utf8");
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: extracted });
  const cli = path.join(extracted, "node_modules", "@thunder-doctor", "code-doctor", "dist", "cli.js");
  assert.equal(run(process.execPath, [cli, "--version"]).trim(), packageVersion);

  const tsFixture = await makeFixture("ts-vue-project", {
    "src/main.ts": "export const start = () => ({ ok: true });\n",
    "src/legacy.js": "export function legacy() { return true }\n",
    "src/App.vue": "<template><main>业务入口</main></template><script setup lang=\"ts\">import { start } from './main'</script>\n",
  });
  const goFixture = await makeFixture("go-project", { "main.go": "package main\nfunc main() {}\n" });
  for (const fixture of [tsFixture, goFixture]) {
    const output = run(process.execPath, [cli, "project", "start", "--limit", "1", "-C", fixture], { cwd: fixture });
    assert.match(output, /项目业务审计入口/);
    const report = JSON.parse(await fs.readFile(path.join(fixture, ".code-doctor", "output", "project-report.json"), "utf8"));
    assert.equal(report.coverage.discovered, 1);
    assert.equal(report.coverage.mapped, 1);
    assert.equal(report.audit.agent.status, "completed");
    const html = await fs.readFile(path.join(fixture, ".code-doctor", "output", "project-report.html"), "utf8");
    assert.match(html, /核心业务流程/);
    assert(!/tesla|车机/i.test(html));
    const doctor = JSON.parse(run(process.execPath, [cli, "project", "doctor", "--json", "-C", fixture], { cwd: fixture }));
    assert.equal(doctor.agent.available, true);
    assert.equal(doctor.knowledge.mapped, 1);
  }

  const empty = path.join(workspace, "empty-project");
  await fs.mkdir(empty);
  run(process.execPath, [cli, "project", "start", "--limit", "1", "-C", empty], { cwd: empty, env: { PATH: "/usr/bin:/bin" } });
  const emptyReport = JSON.parse(await fs.readFile(path.join(empty, ".code-doctor", "output", "project-report.json"), "utf8"));
  assert.equal(emptyReport.coverage.discovered, 0);
  console.log("packed CLI e2e passed: TS/JS/Vue, Go, empty/no-agent fallback");
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
