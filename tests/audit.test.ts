import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditChanged, auditDeep } from "../src/audit.js";
import { buildBusinessMap } from "../src/business-map/build.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import { addConfirmedRule, confirmScenario } from "../src/knowledge.js";
import { runCommand } from "../src/process.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("continuous business audit", () => {
  it("只审计 Git 变更实际影响的已沉淀业务场景", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-audit-"));
    directories.push(root);
    await fs.writeFile(path.join(root, "app.ts"), "export const popup = (expired: boolean) => expired ? 'renew' : 'none';\n", "utf8");
    await fs.writeFile(path.join(root, "agent.mjs"), `import fs from 'node:fs';
const prompt = fs.readFileSync(process.argv[2], 'utf8');
if (prompt.includes('map-task.json')) {
  const task=JSON.parse(fs.readFileSync('.code-doctor/map-task.json','utf8'));
  fs.writeFileSync(task.candidateFile, JSON.stringify({title:'续费弹窗',summary:'会员过期时展示',nodes:[{id:'decision.expired',label:'会员是否过期',kind:'decision',summary:'检查 expired',status:'fact',evidenceIds:['src.popup']},{id:'outcome.renew',label:'续费弹窗',kind:'outcome',summary:'返回 renew',status:'fact',evidenceIds:['src.popup']}],edges:[{id:'edge.renew',from:'decision.expired',to:'outcome.renew',guard:'expired=true',status:'fact',confidence:1,evidenceIds:['src.popup']}],evidence:[{id:'src.popup',kind:'source',description:'弹窗判断',location:{file:'app.ts',line:1},confidence:1}],uncertainties:[]}));
} else {
  const name=fs.readdirSync('.code-doctor').find(file=>file.startsWith('check-')&&file.endsWith('-task.json'));
  const task=JSON.parse(fs.readFileSync('.code-doctor/'+name,'utf8'));
  fs.writeFileSync(task.candidateFile, JSON.stringify({expectation:{interpretation:'检查变更影响',actors:['会员'],preconditions:[],expectedOutcomes:['续费弹窗'],assumptions:[]},conclusion:'变更影响续费弹窗条件。',findings:[{id:'finding.change',status:'uncertain',severity:'warning',title:'条件发生变化',conclusion:'需要回归测试',reasoning:['app.ts 被修改'],relatedNodeIds:['decision.expired'],evidenceIds:['src.popup'],confidence:.8}],unansweredQuestions:['新条件是否符合产品需求？']}));
}
`, "utf8");
    await runCommand({ command: "git init -b main && git config user.name 'Test' && git config user.email 'test@example.com' && git add app.ts agent.mjs && git commit -m baseline", cwd: root });
    const config = { ...DEFAULT_CONFIG, agent: { provider: "custom" as const, command: "node agent.mjs {promptFile}" }, graph: { ...DEFAULT_CONFIG.graph, include: ["**/*.ts"] } };
    const built = await buildBusinessMap({ root, config, focus: "续费弹窗", scenarioId: "vip-renewal" });
    expect(built.map.chapters).toEqual([expect.objectContaining({ nodeIds: ["decision.expired", "outcome.renew"] })]);
    await confirmScenario({ root, id: "vip-renewal", reviewer: "owner" });
    await addConfirmedRule({ root, id: "vip-daily-once", scenarioId: "vip-renewal", statement: "会员过期弹窗每天最多展示一次", reviewer: "owner" });
    await fs.writeFile(path.join(root, "app.ts"), "export const popup = (expired: boolean) => expired === true ? 'renew' : 'none';\n", "utf8");
    await runCommand({ command: "git add app.ts && git commit -m change", cwd: root });

    const changed = await auditChanged({ root, config, range: "HEAD^...HEAD" });
    expect(changed.selectedScenarios).toEqual([expect.objectContaining({ id: "vip-renewal", status: "reviewed" })]);
    expect(changed.reports[0]?.report.findings[0]).toMatchObject({ id: "finding.change", status: "uncertain" });
    expect(changed.uncoveredFiles).toEqual([]);
    const checkTask = JSON.parse(await fs.readFile(path.join(root, ".code-doctor", "check-vip-renewal-task.json"), "utf8")) as { requirement: string };
    expect(checkTask.requirement).toContain("会员过期弹窗每天最多展示一次");
    expect(checkTask.requirement).toContain("人工确认的业务规则");

    const deep = await auditDeep({ root, config, one: true });
    expect(deep.selectedScenarios).toHaveLength(1);
    expect(deep.reports[0]?.scenarioId).toBe("vip-renewal");
  });
});
