import { stableId } from "../utils.js";
const nodeRefs = (scenarioId, nodeIds) => [...new Set(nodeIds)].sort().map((nodeId) => ({ scenarioId, nodeId }));
const finding = (input) => {
    const nodes = nodeRefs(input.scenario.id, input.nodeIds ?? []);
    const evidenceIds = [...new Set(input.evidenceIds ?? [])].sort();
    return {
        id: `structure-${stableId(input.scenario.id, input.code, ...nodes.map((item) => item.nodeId), ...evidenceIds)}`,
        source: "structure",
        category: input.category,
        status: "uncertain",
        severity: input.severity,
        title: input.title,
        conclusion: input.conclusion,
        reasoning: input.reasoning,
        relatedScenarioIds: [input.scenario.id],
        relatedNodes: nodes,
        evidence: evidenceIds.map((evidenceId) => ({ scenarioId: input.scenario.id, evidenceId })),
        confidence: input.severity === "info" ? 0.72 : 0.86,
        recommendation: input.recommendation,
    };
};
const normalizeGuard = (value) => (value ?? "").trim().toLocaleLowerCase().replaceAll(/\s+/g, " ");
export const findStructuralRisks = (scenario) => {
    const map = scenario.map;
    if (!map)
        return [];
    const findings = [];
    const byId = new Map(map.nodes.map((node) => [node.id, node]));
    const incoming = new Map(map.nodes.map((node) => [node.id, []]));
    const outgoing = new Map(map.nodes.map((node) => [node.id, []]));
    for (const edge of map.edges) {
        incoming.get(edge.to)?.push(edge);
        outgoing.get(edge.from)?.push(edge);
    }
    const entries = map.nodes.filter((node) => !(incoming.get(node.id)?.length));
    if (!entries.length)
        findings.push(finding({
            scenario, code: "missing-entry", category: "missing_entry", severity: "warning",
            title: "结构风险：场景没有可识别入口",
            conclusion: "当前地图中的每个节点都有前驱，无法识别业务从哪里开始；可能是闭环业务，也可能遗漏了触发入口。",
            reasoning: [`地图包含 ${map.nodes.length} 个节点和 ${map.edges.length} 条路径，但入度为 0 的节点数量为 0。`],
            nodeIds: map.nodes.map((node) => node.id),
            recommendation: "确认定时器、路由、用户动作、消息消费或生命周期回调等真实入口，并补入地图。",
        }));
    const outcomes = map.nodes.filter((node) => node.kind === "outcome");
    if (!outcomes.length)
        findings.push(finding({
            scenario, code: "missing-outcome", category: "missing_outcome", severity: "warning",
            title: "结构风险：场景没有业务结果",
            conclusion: "地图没有 outcome 节点，无法判断这条业务链最终向用户或系统交付了什么结果。",
            reasoning: ["节点类型中没有 outcome。"], nodeIds: map.nodes.map((node) => node.id),
            recommendation: "补充成功、失败、取消、降级等可观察结果；若确实是长期状态机，请明确结束条件。",
        }));
    const isolated = map.nodes.filter((node) => !(incoming.get(node.id)?.length) && !(outgoing.get(node.id)?.length));
    if (isolated.length)
        findings.push(finding({
            scenario, code: "isolated", category: "unreachable", severity: "warning",
            title: "结构风险：存在孤立业务节点",
            conclusion: `${isolated.length} 个节点没有任何上下游连接，当前地图无法证明它们会被执行。`,
            reasoning: isolated.map((node) => `“${node.label}”既没有进入路径，也没有离开路径。`),
            nodeIds: isolated.map((node) => node.id), recommendation: "核对源码入口与调用关系；无效节点应删除，有效节点应补齐触发和结果路径。",
        }));
    const deadEnds = map.nodes.filter((node) => node.kind !== "outcome" && node.kind !== "side_effect" && !isolated.includes(node) && !(outgoing.get(node.id)?.length));
    if (deadEnds.length)
        findings.push(finding({
            scenario, code: "dead-end", category: "dead_end", severity: "warning",
            title: "结构风险：非结果节点提前终止",
            conclusion: `${deadEnds.length} 个非结果节点没有后续路径，业务可能在到达结果前中断。`,
            reasoning: deadEnds.map((node) => `“${node.label}”（${node.kind}）没有离开路径。`),
            nodeIds: deadEnds.map((node) => node.id), recommendation: "确认这些节点之后应进入成功、失败、重试、取消还是降级结果。",
        }));
    for (const decision of map.nodes.filter((node) => node.kind === "decision")) {
        const branches = outgoing.get(decision.id) ?? [];
        if (branches.length < 2)
            findings.push(finding({
                scenario, code: `decision-branches-${decision.id}`, category: "decision_branch", severity: "warning",
                title: "结构风险：判断节点缺少有效分支",
                conclusion: `“${decision.label}”只有 ${branches.length} 条离开路径，无法证明条件的其他取值会被处理。`,
                reasoning: branches.length ? [`唯一分支条件为“${branches[0].guard || branches[0].label || "未标注"}”。`] : ["该判断节点没有任何离开路径。"],
                nodeIds: [decision.id, ...branches.map((edge) => edge.to)],
                evidenceIds: [...decision.evidenceIds, ...branches.flatMap((edge) => edge.evidenceIds)],
                recommendation: "补齐 true/false、枚举默认值、异常或兜底分支，并确认每个分支都能到达结果。",
            }));
        const empty = branches.filter((edge) => !normalizeGuard(edge.guard || edge.label));
        const grouped = new Map();
        for (const edge of branches) {
            const guard = normalizeGuard(edge.guard || edge.label);
            if (!guard)
                continue;
            grouped.set(guard, [...(grouped.get(guard) ?? []), edge]);
        }
        const duplicated = [...grouped.values()].filter((edges) => edges.length > 1).flat();
        if (empty.length || duplicated.length)
            findings.push(finding({
                scenario, code: `guard-conflict-${decision.id}`, category: "guard_conflict", severity: "warning",
                title: "结构风险：判断分支条件为空或重复",
                conclusion: `“${decision.label}”存在 ${empty.length} 条未标条件、${duplicated.length} 条条件重复的路径，无法证明分支互斥且覆盖完整。`,
                reasoning: [
                    ...empty.map((edge) => `路径 ${edge.id} 未提供 guard 或 label。`),
                    ...[...grouped.entries()].filter(([, edges]) => edges.length > 1).map(([guard, edges]) => `条件“${guard}”被 ${edges.length} 条路径重复使用。`),
                ],
                nodeIds: [decision.id, ...[...empty, ...duplicated].map((edge) => edge.to)],
                evidenceIds: [...decision.evidenceIds, ...[...empty, ...duplicated].flatMap((edge) => edge.evidenceIds)],
                recommendation: "把分支条件写成可比较的业务谓词，并补充默认/异常分支；复杂布尔条件建议由测试覆盖边界值。",
            }));
    }
    const unvisited = new Set(map.nodes.map((node) => node.id));
    const components = [];
    while (unvisited.size) {
        const first = unvisited.values().next().value;
        const queue = [first];
        const component = [];
        unvisited.delete(first);
        while (queue.length) {
            const id = queue.shift();
            component.push(id);
            const neighbours = [...(incoming.get(id) ?? []), ...(outgoing.get(id) ?? [])]
                .flatMap((edge) => [edge.from, edge.to]);
            for (const neighbour of neighbours)
                if (unvisited.delete(neighbour))
                    queue.push(neighbour);
        }
        components.push(component.sort());
    }
    if (components.length > 1 && map.nodes.length > 1)
        findings.push(finding({
            scenario, code: "disconnected-components", category: "unreachable", severity: "warning",
            title: "结构风险：场景包含彼此不连通的业务组件",
            conclusion: `地图被分成 ${components.length} 个互不连接的组件，无法从一条业务链解释所有节点。`,
            reasoning: components.map((component, index) => `组件 ${index + 1}：${component.map((id) => byId.get(id)?.label ?? id).join("、")}`),
            nodeIds: components.flat(), recommendation: "确认这是多个应拆分的场景，还是建图时遗漏了跨组件路径。",
        }));
    const evidenceIds = new Set(map.evidence.map((item) => item.id));
    const duplicateEvidence = map.evidence.filter((item, index) => map.evidence.findIndex((candidate) => candidate.id === item.id) !== index);
    const invalidReferences = [
        ...map.nodes.flatMap((node) => node.evidenceIds.filter((id) => !evidenceIds.has(id)).map((id) => `${node.id}:${id}`)),
        ...map.edges.flatMap((edge) => edge.evidenceIds.filter((id) => !evidenceIds.has(id)).map((id) => `${edge.id}:${id}`)),
    ];
    const noEvidenceNodes = map.nodes.filter((node) => !node.evidenceIds.length);
    const noEvidenceEdges = map.edges.filter((edge) => !edge.evidenceIds.length);
    if (duplicateEvidence.length || invalidReferences.length || noEvidenceNodes.length || noEvidenceEdges.length)
        findings.push(finding({
            scenario, code: "evidence-gap", category: "evidence_gap", severity: invalidReferences.length ? "warning" : "info",
            title: "需复核：部分结构缺少可追溯证据",
            conclusion: "地图中的部分节点或路径无法完整回指证据，相关业务结论不能视为已证明。",
            reasoning: [
                ...(noEvidenceNodes.length ? [`${noEvidenceNodes.length} 个节点没有 evidenceIds。`] : []),
                ...(noEvidenceEdges.length ? [`${noEvidenceEdges.length} 条路径没有 evidenceIds。`] : []),
                ...(invalidReferences.length ? [`${invalidReferences.length} 个证据引用不存在：${invalidReferences.join("、")}`] : []),
                ...(duplicateEvidence.length ? [`存在重复证据 id：${[...new Set(duplicateEvidence.map((item) => item.id))].join("、")}`] : []),
            ],
            nodeIds: noEvidenceNodes.map((node) => node.id), recommendation: "补充源码、测试、运行或人工证据；不能补证的结论应保持 unknown/inference。",
        }));
    const conflictedNodes = map.nodes.filter((node) => node.status === "conflicted");
    const conflictedEdges = map.edges.filter((edge) => edge.status === "conflicted");
    if (conflictedNodes.length || conflictedEdges.length)
        findings.push(finding({
            scenario, code: "evidence-conflict", category: "evidence_conflict", severity: "warning",
            title: "需复核：业务证据存在冲突",
            conclusion: "代码、测试、运行或人工信息之间存在冲突，当前地图不能给出唯一业务结论。",
            reasoning: [
                ...conflictedNodes.map((node) => `节点“${node.label}”标记为 conflicted。`),
                ...conflictedEdges.map((edge) => `路径 ${edge.id} 标记为 conflicted。`),
            ],
            nodeIds: [...conflictedNodes.map((node) => node.id), ...conflictedEdges.flatMap((edge) => [edge.from, edge.to])],
            evidenceIds: [...conflictedNodes.flatMap((node) => node.evidenceIds), ...conflictedEdges.flatMap((edge) => edge.evidenceIds)],
            recommendation: "优先核对运行事实和已确认规则，明确哪一份证据已过期。",
        }));
    return findings;
};
//# sourceMappingURL=structure.js.map