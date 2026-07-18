import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import { scanFailureMessages, scanProject, selectOneDiagnostic } from "../src/scan.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("scanProject", () => {
  it("把无诊断的非零退出识别为扫描失败", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-scan-failure-"));
    directories.push(root);
    const report = await scanProject({
      root,
      config: {
        ...DEFAULT_CONFIG,
        scanners: [{
          name: "broken",
          command: "node -e 'console.error(\"scanner unavailable\"); process.exit(2)'",
          parser: "generic",
        }],
      },
    });

    expect(report.diagnostics).toHaveLength(0);
    expect(scanFailureMessages(report)[0]).toContain("scanner unavailable");
  });

  it("允许 AI 选择扫描器不能自动修复的诊断", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-scan-selection-"));
    directories.push(root);
    await fs.writeFile(path.join(root, "app.js"), "const unused = true;\n", "utf8");
    const report = await scanProject({
      root,
      config: {
        ...DEFAULT_CONFIG,
        scanners: [{
          name: "fixture",
          command: "node -e 'console.log(JSON.stringify({diagnostics:[{rule:\"no-unused-vars\",severity:\"warning\",message:\"unused\",file:\"app.js\",line:1,fixable:false}]}))'",
          parser: "generic",
        }],
      },
    });

    expect(selectOneDiagnostic(report)).toMatchObject({ rule: "no-unused-vars", fixable: false });
  });
});
