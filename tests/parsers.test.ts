import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDiagnostics } from "../src/scanners/parsers.js";

const directories: string[] = [];

const makeRoot = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-parser-"));
  directories.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("parseDiagnostics", () => {
  it("把 ESLint JSON 转换成稳定诊断", async () => {
    const root = await makeRoot();
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "app.ts"), "const unused = 1;\n", "utf8");
    const stdout = JSON.stringify([
      {
        filePath: path.join(root, "src", "app.ts"),
        messages: [
          {
            ruleId: "no-unused-vars",
            severity: 2,
            message: "unused is assigned but never used",
            line: 1,
            column: 7,
          },
        ],
      },
    ]);
    const first = await parseDiagnostics({
      root,
      scanner: "eslint",
      parser: "eslint",
      stdout,
      stderr: "",
    });
    const second = await parseDiagnostics({
      root,
      scanner: "eslint",
      parser: "eslint",
      stdout,
      stderr: "",
    });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      scanner: "eslint",
      rule: "no-unused-vars",
      severity: "error",
      location: { file: "src/app.ts", line: 1, column: 7 },
    });
    expect(first[0]!.id).toBe(second[0]!.id);
  });

  it("解析 TypeScript 编译器输出", async () => {
    const root = await makeRoot();
    await fs.writeFile(path.join(root, "app.ts"), "const value: string = 1;\n", "utf8");
    const diagnostics = await parseDiagnostics({
      root,
      scanner: "typescript",
      parser: "tsc",
      stdout: "app.ts(1,7): error TS2322: Type 'number' is not assignable to type 'string'.",
      stderr: "",
    });
    expect(diagnostics[0]).toMatchObject({
      rule: "TS2322",
      severity: "error",
      location: { file: "app.ts", line: 1, column: 7 },
    });
  });
});
