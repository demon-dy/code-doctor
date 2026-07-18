import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import { analyzeCodeGraph } from "../src/graph/analyze.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("analyzeCodeGraph", () => {
  it("连接 TS 客户端请求与服务端路由", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-graph-"));
    directories.push(root);
    await fs.mkdir(path.join(root, "client"));
    await fs.mkdir(path.join(root, "server"));
    await fs.writeFile(
      path.join(root, "client", "orders.ts"),
      `export const loadOrder = async (id: string) => fetch(\`/api/orders/\${id}\`);\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "server", "routes.ts"),
      `const getOrder = () => null;\nrouter.get("/api/orders/:id", getOrder);\n`,
      "utf8",
    );
    const graph = await analyzeCodeGraph({ root, config: DEFAULT_CONFIG });
    const endpoint = graph.nodes.find((node) => node.id === "endpoint:GET:/api/orders/:param");
    expect(endpoint).toBeDefined();
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "file:client/orders.ts", to: endpoint!.id, kind: "http" }),
      expect.objectContaining({ from: endpoint!.id, to: "function:server/routes.ts:getOrder", kind: "route" }),
    ]));
  });

  it("提取 Go 路由和函数调用", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-go-"));
    directories.push(root);
    await fs.writeFile(
      path.join(root, "main.go"),
      `package main\nfunc findOrder() {}\nfunc getOrder() { findOrder() }\nfunc routes() { r.GET("/api/orders/:id", getOrder) }\n`,
      "utf8",
    );
    const graph = await analyzeCodeGraph({ root, config: DEFAULT_CONFIG });
    expect(graph.nodes.some((node) => node.id === "endpoint:GET:/api/orders/:param")).toBe(true);
    expect(graph.edges.some((edge) => edge.from.endsWith(":getOrder") && edge.to.endsWith(":findOrder"))).toBe(true);
  });

  it("解析 JavaScript、Vue script 和 @ 路径导入", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-vue-"));
    directories.push(root);
    await fs.mkdir(path.join(root, "src", "api"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "api", "orders.js"),
      `export const loadOrders = () => client.get("/api/orders");\nexport const featureFlag = () => store.get("feature-flag");\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "src", "Orders.vue"),
      `<template><main>orders</main></template>\n<script setup>\nimport { loadOrders } from "@/api/orders";\nconst refresh = () => loadOrders();\n</script>\n`,
      "utf8",
    );

    const graph = await analyzeCodeGraph({ root, config: DEFAULT_CONFIG });

    expect(graph.stats.files).toBe(2);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "file:src/Orders.vue", language: "javascript" }),
      expect.objectContaining({ id: "function:src/Orders.vue:refresh", location: { file: "src/Orders.vue", line: 4 } }),
      expect.objectContaining({ id: "endpoint:GET:/api/orders" }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "file:src/Orders.vue", to: "file:src/api/orders.js", kind: "import" }),
      expect.objectContaining({ from: "file:src/api/orders.js", to: "endpoint:GET:/api/orders", kind: "http" }),
    ]));
    expect(graph.nodes.some((node) => node.id === "endpoint:GET:/feature-flag")).toBe(false);
  });
});
