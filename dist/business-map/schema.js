import fs from "node:fs/promises";
import path from "node:path";
import { makeRunId } from "../utils.js";
const nodeKinds = new Set(["scenario", "actor", "state", "decision", "action", "outcome", "side_effect", "system"]);
const statuses = new Set(["fact", "inference", "confirmed", "unknown", "conflicted"]);
const evidenceKinds = new Set(["source", "test", "git", "runtime", "human", "agent"]);
const findingStatuses = new Set(["satisfied", "violated", "uncertain"]);
const severities = new Set(["error", "warning", "info"]);
const object = (value, name) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${name} 必须是对象`);
    return value;
};
const string = (value, name) => {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${name} 必须是非空字符串`);
    return value.trim();
};
const strings = (value, name) => {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
        throw new Error(`${name} 必须是字符串数组`);
    return value.map((item) => item.trim()).filter(Boolean);
};
const confidence = (value, name) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${name} 必须是 0 到 1 之间的数字`);
    }
    return value;
};
const uniqueIds = (values, name) => {
    const ids = new Set(values.map((value) => value.id));
    if (ids.size !== values.length)
        throw new Error(`${name} 中存在重复 id`);
    return ids;
};
const fallbackChapters = (nodes) => {
    const chapterCount = Math.max(1, Math.min(8, Math.ceil(nodes.length / 6)));
    const chapterSize = Math.ceil(nodes.length / chapterCount);
    return Array.from({ length: chapterCount }, (_, index) => nodes.slice(index * chapterSize, (index + 1) * chapterSize))
        .filter((chapterNodes) => chapterNodes.length)
        .map((chapterNodes, index) => {
        const first = chapterNodes[0];
        const last = chapterNodes.at(-1);
        return {
            id: `chapter-${index + 1}`,
            title: first.id === last.id ? first.label : `${first.label}到${last.label}`,
            summary: `从“${first.label}”推进到“${last.label}”的业务阶段。`,
            nodeIds: chapterNodes.map((node) => node.id),
        };
    });
};
const validateLocation = async (root, evidence) => {
    if (!evidence.location) {
        if (evidence.kind === "source" || evidence.kind === "test")
            throw new Error(`证据 ${evidence.id} 缺少源码位置`);
        return;
    }
    const relative = evidence.location.file.replaceAll("\\", "/");
    const absolute = path.resolve(root, relative);
    const escaped = path.relative(root, absolute).startsWith("..");
    if (escaped)
        throw new Error(`证据 ${evidence.id} 引用了项目之外的文件`);
    const stat = await fs.stat(absolute).catch(() => undefined);
    if (!stat?.isFile())
        throw new Error(`证据 ${evidence.id} 引用的文件不存在：${relative}`);
    if (evidence.location.line !== undefined && (!Number.isInteger(evidence.location.line) || evidence.location.line < 1)) {
        throw new Error(`证据 ${evidence.id} 的行号无效`);
    }
    if (evidence.location.line !== undefined) {
        const content = await fs.readFile(absolute, "utf8");
        const lineCount = content.split(/\r?\n/).length;
        if (evidence.location.line > lineCount)
            throw new Error(`证据 ${evidence.id} 的行号超过文件长度`);
    }
    evidence.location.file = relative;
};
export const finalizeBusinessMap = async (input) => {
    const candidate = object(input.candidate, "业务地图");
    const rawNodes = candidate.nodes;
    const rawEdges = candidate.edges;
    const rawEvidence = candidate.evidence;
    if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges) || !Array.isArray(rawEvidence)) {
        throw new Error("业务地图必须包含 nodes、edges、evidence 数组");
    }
    if (!rawNodes.length)
        throw new Error("业务地图至少需要一个业务节点");
    if (rawNodes.length > input.config.maxNodes)
        throw new Error(`业务节点 ${rawNodes.length} 超过限制 ${input.config.maxNodes}`);
    if (rawEvidence.length > input.config.maxEvidence)
        throw new Error(`业务证据 ${rawEvidence.length} 超过限制 ${input.config.maxEvidence}`);
    const evidence = rawEvidence.map((value, index) => {
        const item = object(value, `evidence[${index}]`);
        const kind = string(item.kind, `evidence[${index}].kind`);
        if (!evidenceKinds.has(kind))
            throw new Error(`evidence[${index}].kind 无效`);
        const locationValue = item.location ? object(item.location, `evidence[${index}].location`) : undefined;
        return {
            id: string(item.id, `evidence[${index}].id`),
            kind: kind,
            description: string(item.description, `evidence[${index}].description`),
            location: locationValue ? {
                file: string(locationValue.file, `evidence[${index}].location.file`),
                line: locationValue.line === undefined ? undefined : Number(locationValue.line),
                column: locationValue.column === undefined ? undefined : Number(locationValue.column),
            } : undefined,
            reference: typeof item.reference === "string" ? item.reference : undefined,
            confidence: confidence(item.confidence, `evidence[${index}].confidence`),
        };
    });
    const evidenceIds = uniqueIds(evidence, "evidence");
    const evidenceById = new Map(evidence.map((item) => [item.id, item]));
    await Promise.all(evidence.map((item) => validateLocation(input.root, item)));
    const nodes = rawNodes.map((value, index) => {
        const item = object(value, `nodes[${index}]`);
        const kind = string(item.kind, `nodes[${index}].kind`);
        const status = string(item.status, `nodes[${index}].status`);
        if (!nodeKinds.has(kind))
            throw new Error(`nodes[${index}].kind 无效`);
        if (!statuses.has(status))
            throw new Error(`nodes[${index}].status 无效`);
        const refs = strings(item.evidenceIds ?? [], `nodes[${index}].evidenceIds`);
        for (const id of refs)
            if (!evidenceIds.has(id))
                throw new Error(`节点引用了不存在的证据：${id}`);
        if (status === "fact" && !refs.length)
            throw new Error(`事实节点 ${item.id ?? index} 必须引用证据`);
        if (status === "confirmed" && !refs.some((id) => evidenceById.get(id)?.kind === "human")) {
            throw new Error(`人工确认节点 ${item.id ?? index} 必须引用 human 证据`);
        }
        return {
            id: string(item.id, `nodes[${index}].id`),
            label: string(item.label, `nodes[${index}].label`),
            kind: kind,
            summary: string(item.summary, `nodes[${index}].summary`),
            status: status,
            evidenceIds: refs,
        };
    });
    const nodeIds = uniqueIds(nodes, "nodes");
    let chapters;
    if (Array.isArray(candidate.chapters) && candidate.chapters.length) {
        if (candidate.chapters.length > 9)
            throw new Error("业务章节不能超过 9 个");
        chapters = candidate.chapters.map((value, index) => {
            const item = object(value, `chapters[${index}]`);
            const chapterNodeIds = strings(item.nodeIds, `chapters[${index}].nodeIds`);
            if (!chapterNodeIds.length)
                throw new Error(`业务章节 ${item.id ?? index} 不能是空章节`);
            for (const id of chapterNodeIds)
                if (!nodeIds.has(id))
                    throw new Error(`业务章节引用了不存在的节点：${id}`);
            return {
                id: string(item.id, `chapters[${index}].id`),
                title: string(item.title, `chapters[${index}].title`),
                summary: string(item.summary, `chapters[${index}].summary`),
                nodeIds: chapterNodeIds,
            };
        });
        uniqueIds(chapters, "chapters");
        const covered = chapters.flatMap((chapter) => chapter.nodeIds);
        const uniqueCovered = new Set(covered);
        if (uniqueCovered.size !== covered.length)
            throw new Error("同一个业务节点不能重复出现在多个章节中");
        const missing = nodes.filter((node) => !uniqueCovered.has(node.id));
        if (missing.length)
            throw new Error(`业务章节没有覆盖全部节点：${missing.map((node) => node.id).join(", ")}`);
    }
    else {
        chapters = fallbackChapters(nodes);
    }
    const edges = rawEdges.map((value, index) => {
        const item = object(value, `edges[${index}]`);
        const from = string(item.from, `edges[${index}].from`);
        const to = string(item.to, `edges[${index}].to`);
        const status = string(item.status, `edges[${index}].status`);
        if (!nodeIds.has(from) || !nodeIds.has(to))
            throw new Error(`边 ${from} → ${to} 引用了不存在的节点`);
        if (!statuses.has(status))
            throw new Error(`edges[${index}].status 无效`);
        const refs = strings(item.evidenceIds ?? [], `edges[${index}].evidenceIds`);
        for (const id of refs)
            if (!evidenceIds.has(id))
                throw new Error(`边引用了不存在的证据：${id}`);
        if (status === "fact" && !refs.length)
            throw new Error(`事实路径 ${item.id ?? index} 必须引用证据`);
        if (status === "confirmed" && !refs.some((id) => evidenceById.get(id)?.kind === "human")) {
            throw new Error(`人工确认路径 ${item.id ?? index} 必须引用 human 证据`);
        }
        return {
            id: string(item.id, `edges[${index}].id`),
            from,
            to,
            label: typeof item.label === "string" ? item.label : undefined,
            guard: typeof item.guard === "string" ? item.guard : undefined,
            status: status,
            confidence: confidence(item.confidence, `edges[${index}].confidence`),
            evidenceIds: refs,
        };
    });
    uniqueIds(edges, "edges");
    return {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        root: input.root,
        title: string(candidate.title, "title"),
        focus: input.focus,
        summary: string(candidate.summary, "summary"),
        chapters,
        nodes,
        edges,
        evidence,
        uncertainties: strings(candidate.uncertainties ?? [], "uncertainties"),
        agent: { provider: input.agent.provider, durationMs: input.agent.durationMs },
    };
};
export const finalizeAuditReport = (input) => {
    const candidate = object(input.candidate, "审计报告");
    const expectationValue = object(candidate.expectation, "expectation");
    const rawFindings = candidate.findings;
    if (!Array.isArray(rawFindings))
        throw new Error("审计报告必须包含 findings 数组");
    const nodeIds = new Set(input.map.nodes.map((node) => node.id));
    const evidenceIds = new Set(input.map.evidence.map((item) => item.id));
    const evidenceById = new Map(input.map.evidence.map((item) => [item.id, item]));
    const findings = rawFindings.map((value, index) => {
        const item = object(value, `findings[${index}]`);
        const status = string(item.status, `findings[${index}].status`);
        const severity = string(item.severity, `findings[${index}].severity`);
        if (!findingStatuses.has(status))
            throw new Error(`findings[${index}].status 无效`);
        if (!severities.has(severity))
            throw new Error(`findings[${index}].severity 无效`);
        const relatedNodeIds = strings(item.relatedNodeIds ?? [], `findings[${index}].relatedNodeIds`);
        const relatedEvidenceIds = strings(item.evidenceIds ?? [], `findings[${index}].evidenceIds`);
        for (const id of relatedNodeIds)
            if (!nodeIds.has(id))
                throw new Error(`结论引用了不存在的业务节点：${id}`);
        for (const id of relatedEvidenceIds)
            if (!evidenceIds.has(id))
                throw new Error(`结论引用了不存在的证据：${id}`);
        const score = confidence(item.confidence, `findings[${index}].confidence`);
        if (score >= 0.9 && !relatedEvidenceIds.some((id) => ["source", "test", "runtime", "human"].includes(evidenceById.get(id)?.kind ?? ""))) {
            throw new Error(`高置信结论 ${item.id ?? index} 必须引用源码、测试、运行或人工证据`);
        }
        return {
            id: string(item.id, `findings[${index}].id`),
            status: status,
            severity: severity,
            title: string(item.title, `findings[${index}].title`),
            conclusion: string(item.conclusion, `findings[${index}].conclusion`),
            reasoning: strings(item.reasoning ?? [], `findings[${index}].reasoning`),
            relatedNodeIds,
            evidenceIds: relatedEvidenceIds,
            confidence: score,
            recommendation: typeof item.recommendation === "string" ? item.recommendation : undefined,
        };
    });
    uniqueIds(findings, "findings");
    return {
        schemaVersion: 1,
        runId: makeRunId(),
        createdAt: new Date().toISOString(),
        root: input.root,
        mapCreatedAt: input.map.createdAt,
        expectation: {
            raw: input.requirement,
            interpretation: string(expectationValue.interpretation, "expectation.interpretation"),
            actors: strings(expectationValue.actors ?? [], "expectation.actors"),
            preconditions: strings(expectationValue.preconditions ?? [], "expectation.preconditions"),
            expectedOutcomes: strings(expectationValue.expectedOutcomes ?? [], "expectation.expectedOutcomes"),
            assumptions: strings(expectationValue.assumptions ?? [], "expectation.assumptions"),
        },
        conclusion: string(candidate.conclusion, "conclusion"),
        findings,
        unansweredQuestions: strings(candidate.unansweredQuestions ?? [], "unansweredQuestions"),
        agent: { provider: input.agent.provider, durationMs: input.agent.durationMs },
    };
};
//# sourceMappingURL=schema.js.map