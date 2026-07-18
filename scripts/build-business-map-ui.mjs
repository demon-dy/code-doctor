import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await build({
  entryPoints: [path.join(root, "ui-src", "business-map.jsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  write: false,
  outdir: "out",
  legalComments: "none",
});

const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
const stylesheet = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
if (!javascript) throw new Error("业务地图 UI 没有生成 JavaScript 产物");

const escapeScriptEnd = (value) => value.replaceAll("</script", "<\\/script");
const target = path.join(root, "src", "business-map", "ui-bundle.ts");
const source = `// 此文件由 npm run build:ui 生成，请勿手工编辑。\n` +
  `export const BUSINESS_MAP_UI_JS: string = ${JSON.stringify(escapeScriptEnd(javascript))};\n` +
  `export const BUSINESS_MAP_UI_CSS: string = ${JSON.stringify(stylesheet)};\n`;
await fs.writeFile(target, source, "utf8");
