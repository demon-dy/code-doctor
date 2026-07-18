import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import { fixOneIssue } from "../src/fix.js";
import { initializeProject } from "../src/init.js";
import { runCommand } from "../src/process.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("fixOneIssue", () => {
  it("扫描、修复、复扫并提交一个问题", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-fix-"));
    directories.push(root);
    await initializeProject(root);
    await fs.writeFile(path.join(root, "app.ts"), "export const status = 'BAD';\n", "utf8");
    await fs.writeFile(
      path.join(root, "scanner.mjs"),
      `import fs from 'node:fs';
const source = fs.readFileSync('app.ts', 'utf8');
console.log(JSON.stringify({ diagnostics: source.includes('BAD') ? [{ rule: 'no-bad-status', severity: 'error', message: '状态不能是 BAD', file: 'app.ts', line: 1, fixable: true }] : [] }));
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "agent.mjs"),
      `import fs from 'node:fs';
fs.writeFileSync('app.ts', fs.readFileSync('app.ts', 'utf8').replace('BAD', 'GOOD'));
console.log(JSON.stringify({ result: 'fixed' }));
`,
      "utf8",
    );
    await runCommand({ command: "git init -b main", cwd: root });
    await runCommand({ command: "git config user.name 'Code Doctor Test' && git config user.email 'code-doctor@example.com'", cwd: root });
    await runCommand({ command: "git add -A && git commit -m 'test: baseline'", cwd: root });

    const record = await fixOneIssue({
      root,
      openMergeRequest: false,
      config: {
        ...DEFAULT_CONFIG,
        scanners: [{ name: "fixture", command: "node scanner.mjs", parser: "generic" }],
        agent: { provider: "custom", command: "node agent.mjs {promptFile}" },
        graph: { ...DEFAULT_CONFIG.graph, enabled: false },
        gitlab: { ...DEFAULT_CONFIG.gitlab, enabled: false },
      },
    });

    expect(record.error).toBeUndefined();
    expect(record.resolved).toBe(true);
    expect(record.verificationPassed).toBe(true);
    expect(record.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(await fs.readFile(path.join(root, "app.ts"), "utf8")).toContain("GOOD");
    const branch = await runCommand({ command: "git branch --show-current", cwd: root });
    expect(branch.stdout.trim()).toMatch(/^code-doctor\//);
  });
});
