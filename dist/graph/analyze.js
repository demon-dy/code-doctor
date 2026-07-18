import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { minimatch } from "minimatch";
import { stableId } from "../utils.js";
const SKIPPED_DIRECTORIES = new Set([
    ".git",
    ".code-doctor",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "vendor",
]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".go"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const walkSourceFiles = async (root) => {
    const files = [];
    const visit = async (directory) => {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith(".") && entry.name !== ".well-known")
                continue;
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRECTORIES.has(entry.name))
                    await visit(path.join(directory, entry.name));
            }
            else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
                files.push(path.join(directory, entry.name));
            }
        }
    };
    await visit(root);
    return files.sort();
};
const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");
const addNode = (collector, node) => {
    const existing = collector.nodes.get(node.id);
    collector.nodes.set(node.id, existing ? { ...existing, ...node, metadata: { ...existing.metadata, ...node.metadata } } : node);
};
const addEdge = (collector, edge) => {
    const id = stableId(edge.from, edge.to, edge.kind, edge.location?.file, edge.location?.line);
    collector.edges.set(id, { id, ...edge });
};
const endpointId = (method, route) => `endpoint:${method.toUpperCase()}:${normalizeRoute(route)}`;
const normalizeRoute = (value) => {
    const templated = value
        .replaceAll(/\$\{[^}]+\}/g, ":param")
        .replaceAll(/\{[^}]+\}/g, ":param");
    try {
        const parsed = new URL(templated, "http://code-doctor.local");
        return parsed.pathname
            .replaceAll(/:[^/]+/g, ":param")
            .replaceAll(/\/+/g, "/") || "/";
    }
    catch {
        return templated.split("?")[0]
            .replaceAll(/:[^/]+/g, ":param")
            || "/";
    }
};
const nodeLine = (sourceFile, node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
const literalText = (node) => {
    if (!node)
        return undefined;
    if (ts.isStringLiteralLike(node))
        return node.text;
    if (ts.isNoSubstitutionTemplateLiteral(node))
        return node.text;
    if (ts.isTemplateExpression(node))
        return node.getText().slice(1, -1);
    return undefined;
};
const resolveImportTarget = async (root, currentFile, specifier) => {
    if (!specifier.startsWith("."))
        return undefined;
    const base = path.resolve(path.dirname(currentFile), specifier);
    const candidates = [
        base,
        ...[".ts", ".tsx", ".mts", ".cts"].map((extension) => `${base}${extension}`),
        ...["index.ts", "index.tsx"].map((name) => path.join(base, name)),
    ];
    for (const candidate of candidates) {
        try {
            const stat = await fs.stat(candidate);
            if (stat.isFile() && candidate.startsWith(root))
                return relative(root, candidate);
        }
        catch { }
    }
    return undefined;
};
const expressionName = (expression) => {
    if (ts.isIdentifier(expression))
        return expression.text;
    if (ts.isPropertyAccessExpression(expression))
        return expression.name.text;
    return undefined;
};
const functionName = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
        return node.name.getText();
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
            return node.name.text;
        }
    }
    return undefined;
};
const methodFromOptions = (expression) => {
    if (!expression || !ts.isObjectLiteralExpression(expression))
        return "GET";
    for (const property of expression.properties) {
        if (!ts.isPropertyAssignment(property) || property.name.getText().replaceAll(/["']/g, "") !== "method")
            continue;
        return literalText(property.initializer)?.toUpperCase() ?? "GET";
    }
    return "GET";
};
const addHttpEndpoint = (input) => {
    const method = input.method.toUpperCase();
    const route = normalizeRoute(input.route);
    const id = endpointId(method, route);
    addNode(input.collector, {
        id,
        label: `${method} ${route}`,
        kind: "endpoint",
        metadata: { method, route },
    });
    if (input.kind === "http") {
        addEdge(input.collector, {
            from: input.fileNodeId,
            to: id,
            kind: "http",
            confidence: "confirmed",
            location: { file: input.file, line: input.line },
        });
    }
    else {
        const handlerId = input.handlerName
            ? `function:${input.file}:${input.handlerName}`
            : input.fileNodeId;
        if (input.handlerName) {
            addNode(input.collector, {
                id: handlerId,
                label: input.handlerName,
                kind: "handler",
                language: input.language,
                location: { file: input.file, line: input.line },
            });
        }
        addEdge(input.collector, {
            from: id,
            to: handlerId,
            kind: "route",
            confidence: "confirmed",
            location: { file: input.file, line: input.line },
        });
    }
};
const analyzeTypeScript = async (root, absoluteFile, collector) => {
    const file = relative(root, absoluteFile);
    const fileNodeId = `file:${file}`;
    const content = await fs.readFile(absoluteFile, "utf8");
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    addNode(collector, {
        id: fileNodeId,
        label: file,
        kind: "file",
        language: "typescript",
        location: { file, line: 1 },
    });
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement))
            continue;
        const specifier = literalText(statement.moduleSpecifier);
        if (!specifier)
            continue;
        const target = await resolveImportTarget(root, absoluteFile, specifier);
        if (target) {
            const targetId = `file:${target}`;
            addNode(collector, {
                id: targetId,
                label: target,
                kind: "file",
                language: "typescript",
                location: { file: target, line: 1 },
            });
            addEdge(collector, {
                from: fileNodeId,
                to: targetId,
                kind: "import",
                confidence: "confirmed",
                location: { file, line: nodeLine(sourceFile, statement) },
            });
        }
    }
    const visit = (node, currentFunction) => {
        const declaredName = functionName(node);
        let nextFunction = currentFunction;
        if (declaredName) {
            const id = `function:${file}:${declaredName}`;
            nextFunction = { id, name: declaredName, file, calls: [] };
            collector.functions.push(nextFunction);
            addNode(collector, {
                id,
                label: declaredName,
                kind: "function",
                language: "typescript",
                location: { file, line: nodeLine(sourceFile, node) },
            });
            addEdge(collector, {
                from: fileNodeId,
                to: id,
                kind: "call",
                confidence: "confirmed",
                location: { file, line: nodeLine(sourceFile, node) },
            });
        }
        if (ts.isCallExpression(node)) {
            const line = nodeLine(sourceFile, node);
            const calledName = expressionName(node.expression);
            if (calledName && nextFunction)
                nextFunction.calls.push({ name: calledName, line });
            if (ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
                const route = literalText(node.arguments[0]);
                if (route) {
                    addHttpEndpoint({
                        collector,
                        fileNodeId,
                        file,
                        line,
                        method: methodFromOptions(node.arguments[1]),
                        route,
                        kind: "http",
                        language: "typescript",
                    });
                }
            }
            if (ts.isPropertyAccessExpression(node.expression)) {
                const method = node.expression.name.text.toUpperCase();
                const route = literalText(node.arguments[0]);
                if (route && HTTP_METHODS.has(method)) {
                    const secondArgument = node.arguments[1];
                    const looksLikeRoute = Boolean(secondArgument &&
                        (ts.isIdentifier(secondArgument) || ts.isArrowFunction(secondArgument) || ts.isFunctionExpression(secondArgument)));
                    addHttpEndpoint({
                        collector,
                        fileNodeId,
                        file,
                        line,
                        method,
                        route,
                        kind: looksLikeRoute ? "route" : "http",
                        handlerName: secondArgument && ts.isIdentifier(secondArgument) ? secondArgument.text : undefined,
                        language: "typescript",
                    });
                }
            }
        }
        ts.forEachChild(node, (child) => visit(child, nextFunction));
    };
    visit(sourceFile);
    const controllerPrefix = content.match(/@Controller\(\s*["'`]([^"'`]*)["'`]\s*\)/)?.[1] ?? "";
    const decoratorPattern = /@(Get|Post|Put|Patch|Delete)\(\s*["'`]([^"'`]*)["'`]\s*\)\s*(?:public\s+|private\s+|protected\s+|async\s+)*([\w$]+)\s*\(/g;
    for (const match of content.matchAll(decoratorPattern)) {
        const line = content.slice(0, match.index).split(/\r?\n/).length;
        addHttpEndpoint({
            collector,
            fileNodeId,
            file,
            line,
            method: match[1],
            route: `/${controllerPrefix}/${match[2]}`,
            kind: "route",
            handlerName: match[3],
            language: "typescript",
        });
    }
};
const analyzeGo = async (root, absoluteFile, collector) => {
    const file = relative(root, absoluteFile);
    const fileNodeId = `file:${file}`;
    const content = await fs.readFile(absoluteFile, "utf8");
    addNode(collector, {
        id: fileNodeId,
        label: file,
        kind: "file",
        language: "go",
        location: { file, line: 1 },
    });
    const functionPattern = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\([^)]*\)/gm;
    const functionMatches = [...content.matchAll(functionPattern)];
    for (let index = 0; index < functionMatches.length; index += 1) {
        const match = functionMatches[index];
        const name = match[1];
        const line = content.slice(0, match.index).split(/\r?\n/).length;
        const nextIndex = functionMatches[index + 1]?.index ?? content.length;
        const body = content.slice(match.index, nextIndex);
        const calls = [...body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)]
            .filter((call) => !["if", "for", "switch", "return", "func"].includes(call[1]))
            .map((call) => ({
            name: call[1],
            line: line + body.slice(0, call.index).split(/\r?\n/).length - 1,
        }));
        const id = `function:${file}:${name}`;
        collector.functions.push({ id, name, file, calls });
        addNode(collector, {
            id,
            label: name,
            kind: "function",
            language: "go",
            location: { file, line },
        });
        addEdge(collector, {
            from: fileNodeId,
            to: id,
            kind: "call",
            confidence: "confirmed",
            location: { file, line },
        });
    }
    const routePatterns = [
        /\.\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\(\s*"([^"]+)"\s*,\s*([A-Za-z_]\w*)/g,
        /HandleFunc\(\s*"([^"]+)"\s*,\s*([A-Za-z_]\w*)/g,
    ];
    for (const [patternIndex, pattern] of routePatterns.entries()) {
        for (const match of content.matchAll(pattern)) {
            const line = content.slice(0, match.index).split(/\r?\n/).length;
            addHttpEndpoint({
                collector,
                fileNodeId,
                file,
                line,
                method: patternIndex === 0 ? match[1] : "ANY",
                route: patternIndex === 0 ? match[2] : match[1],
                kind: "route",
                handlerName: patternIndex === 0 ? match[3] : match[2],
                language: "go",
            });
        }
    }
    const outgoingPatterns = [
        /http\.(Get|Post)\(\s*"([^"]+)"/g,
        /http\.NewRequest(?:WithContext)?\([^,]+,\s*"(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)"\s*,\s*"([^"]+)"/g,
    ];
    for (const pattern of outgoingPatterns) {
        for (const match of content.matchAll(pattern)) {
            const line = content.slice(0, match.index).split(/\r?\n/).length;
            addHttpEndpoint({
                collector,
                fileNodeId,
                file,
                line,
                method: match[1],
                route: match[2],
                kind: "http",
                language: "go",
            });
        }
    }
};
const connectFunctionCalls = (collector) => {
    const byName = new Map();
    for (const entry of collector.functions) {
        byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);
    }
    for (const source of collector.functions) {
        for (const call of source.calls) {
            const candidates = byName.get(call.name) ?? [];
            if (candidates.length !== 1 || candidates[0].id === source.id)
                continue;
            addEdge(collector, {
                from: source.id,
                to: candidates[0].id,
                kind: "call",
                confidence: "inferred",
                location: { file: source.file, line: call.line },
            });
        }
    }
};
export const analyzeCodeGraph = async (input) => {
    const collector = {
        nodes: new Map(),
        edges: new Map(),
        functions: [],
    };
    const files = (await walkSourceFiles(input.root)).filter((file) => {
        const name = relative(input.root, file);
        const isIncluded = input.config.graph.include.some((pattern) => minimatch(name, pattern));
        const isExcluded = input.config.graph.exclude.some((pattern) => minimatch(name, pattern));
        return isIncluded && !isExcluded;
    });
    for (const file of files) {
        if (file.endsWith(".go"))
            await analyzeGo(input.root, file, collector);
        else
            await analyzeTypeScript(input.root, file, collector);
    }
    connectFunctionCalls(collector);
    const nodes = [...collector.nodes.values()];
    const edges = [...collector.edges.values()];
    return {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        root: input.root,
        nodes,
        edges,
        stats: {
            files: files.length,
            nodes: nodes.length,
            edges: edges.length,
            endpoints: nodes.filter((node) => node.kind === "endpoint").length,
            confirmedEdges: edges.filter((edge) => edge.confidence === "confirmed").length,
            inferredEdges: edges.filter((edge) => edge.confidence === "inferred").length,
        },
    };
};
//# sourceMappingURL=analyze.js.map