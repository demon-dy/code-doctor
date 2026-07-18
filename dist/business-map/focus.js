export const collectFocusedSubgraph = (businessEdges, selection, mode) => {
    if (!selection)
        return undefined;
    const nodes = new Set();
    const edges = new Set();
    const outgoing = new Map();
    const incoming = new Map();
    for (const edge of businessEdges) {
        outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
        incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    }
    const walk = (start, adjacency, next) => {
        const visited = new Set();
        const queue = [start];
        while (queue.length) {
            const current = queue.shift();
            if (visited.has(current))
                continue;
            visited.add(current);
            nodes.add(current);
            for (const edge of adjacency.get(current) ?? []) {
                edges.add(edge.id);
                const target = next(edge);
                nodes.add(target);
                if (!visited.has(target))
                    queue.push(target);
            }
        }
    };
    if (selection.type === "node") {
        nodes.add(selection.id);
        if (mode !== "downstream")
            walk(selection.id, incoming, (edge) => edge.from);
        if (mode !== "upstream")
            walk(selection.id, outgoing, (edge) => edge.to);
        return { nodes, edges };
    }
    const selectedEdge = businessEdges.find((edge) => edge.id === selection.id);
    if (!selectedEdge)
        return { nodes, edges };
    nodes.add(selectedEdge.from);
    nodes.add(selectedEdge.to);
    edges.add(selectedEdge.id);
    if (mode !== "downstream")
        walk(selectedEdge.from, incoming, (edge) => edge.from);
    if (mode !== "upstream")
        walk(selectedEdge.to, outgoing, (edge) => edge.to);
    return { nodes, edges };
};
//# sourceMappingURL=focus.js.map