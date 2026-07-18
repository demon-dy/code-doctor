import fs from "node:fs/promises";
import path from "node:path";
import { commandExists, pathExists } from "../utils.js";
export const discoverScanners = async (root) => {
    const scanners = [];
    const packageFile = path.join(root, "package.json");
    if (await pathExists(packageFile)) {
        const manifest = JSON.parse(await fs.readFile(packageFile, "utf8"));
        const packages = { ...manifest.dependencies, ...manifest.devDependencies };
        if (packages["react-doctor"]) {
            scanners.push({
                name: "react-doctor",
                command: "npx --no-install react-doctor --json",
                parser: "react-doctor",
            });
        }
        if (packages.eslint) {
            scanners.push({
                name: "eslint",
                command: "npx --no-install eslint . --format json",
                parser: "eslint",
            });
        }
        if (packages.typescript && (await pathExists(path.join(root, "tsconfig.json")))) {
            scanners.push({
                name: "typescript",
                command: "npx --no-install tsc --noEmit --pretty false",
                parser: "tsc",
            });
        }
    }
    if (await pathExists(path.join(root, "go.mod"))) {
        if (await commandExists("staticcheck")) {
            scanners.push({ name: "staticcheck", command: "staticcheck ./...", parser: "go" });
        }
        else if (await commandExists("golangci-lint")) {
            scanners.push({
                name: "golangci-lint",
                command: "golangci-lint run --out-format line-number",
                parser: "go",
            });
        }
        else {
            scanners.push({ name: "go-vet", command: "go vet ./...", parser: "go" });
        }
    }
    return scanners;
};
//# sourceMappingURL=auto.js.map