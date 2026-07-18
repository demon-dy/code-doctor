import fs from "node:fs";

const allowedRegistry = "https://g.ktvsky.com/api/v4/projects/2088/packages/npm/";
const packageManifest = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const configuredRegistry = process.env.npm_config_registry;

if (packageManifest.publishConfig?.registry !== allowedRegistry) {
  console.error("拒绝发布：package.json 的 publishConfig 未锁定公司内部 GitLab Registry。");
  process.exit(1);
}

if (configuredRegistry && new URL(configuredRegistry).href !== allowedRegistry) {
  console.error(`拒绝发布：目标 Registry 不是公司内部地址：${configuredRegistry}`);
  process.exit(1);
}
