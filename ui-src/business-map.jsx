import React, { memo, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./business-map.css";
import { collectFocusedSubgraph } from "../src/business-map/focus.ts";

const map = window.__CODE_DOCTOR_MAP__;
const elk = new ELK();

const kindMeta = {
  actor: { label: "角色", glyph: "人" },
  scenario: { label: "场景", glyph: "景" },
  action: { label: "动作", glyph: "动" },
  decision: { label: "判断", glyph: "判" },
  state: { label: "状态", glyph: "态" },
  system: { label: "系统", glyph: "系" },
  outcome: { label: "结果", glyph: "果" },
  side_effect: { label: "副作用", glyph: "副" },
};

const statusMeta = {
  fact: { label: "代码事实", short: "事实" },
  confirmed: { label: "人工确认", short: "人工" },
  inference: { label: "AI 推断", short: "推断" },
  unknown: { label: "证据未知", short: "未知" },
  conflicted: { label: "证据冲突", short: "冲突" },
};

const nodeSize = (node) => {
  const width = node.kind === "actor" ? 230 : node.kind === "state" ? 248 : 258;
  const summaryLines = Math.max(2, Math.min(5, Math.ceil(node.summary.length / 21)));
  const titleLines = Math.max(1, Math.min(2, Math.ceil(node.label.length / 17)));
  const height = 78 + summaryLines * 15 + (titleLines - 1) * 18;
  return { width, height, summaryLines, titleLines };
};

const layoutGraph = async () => {
  const children = map.nodes.map((node) => ({ id: node.id, ...nodeSize(node) }));
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.spacing.nodeNode": "56",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    },
    children,
    edges: map.edges.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
  });
  const positions = new Map((graph.children ?? []).map((node) => [node.id, node]));
  return map.nodes.map((node) => {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    const size = nodeSize(node);
    return {
      id: node.id,
      type: node.kind,
      position: { x: position.x ?? 0, y: position.y ?? 0 },
      data: { businessNode: node, summaryLines: size.summaryLines, titleLines: size.titleLines },
      width: size.width,
      height: size.height,
    };
  });
};

const BusinessNode = memo(({ data, selected }) => {
  const node = data.businessNode;
  const kind = kindMeta[node.kind] ?? { label: node.kind, glyph: "点" };
  const status = statusMeta[node.status] ?? { label: node.status, short: node.status };
  return (
    <div className={`business-node kind-${node.kind} status-${node.status} ${selected ? "is-selected" : ""}`} aria-label={`${kind.label}：${node.label}，${status.label}`}>
      <Handle className="business-handle target" type="target" position={Position.Left} />
      <div className="node-heading">
        <span className="kind-glyph" aria-hidden="true">{kind.glyph}</span>
        <span className="kind-label">{kind.label}</span>
        <span className={`status-chip status-${node.status}`} title={status.label}>{status.short}</span>
      </div>
      <div className="node-title" style={{ WebkitLineClamp: data.titleLines }} title={node.label}>{node.label}</div>
      <div className="node-summary" style={{ WebkitLineClamp: data.summaryLines, height: `${data.summaryLines * 1.4}em` }} title={node.summary}>{node.summary}</div>
      <Handle className="business-handle source" type="source" position={Position.Right} />
    </div>
  );
});

const nodeTypes = Object.fromEntries(Object.keys(kindMeta).map((kind) => [kind, BusinessNode]));

const evidenceById = new Map(map.evidence.map((item) => [item.id, item]));
const nodeById = new Map(map.nodes.map((item) => [item.id, item]));

function DetailPanel({ selection, onSelectNode }) {
  if (!selection) {
    return (
      <aside className="detail-panel">
        <div className="eyebrow">当前业务场景</div>
        <h2>{map.title}</h2>
        <p className="detail-lead">{map.summary}</p>
        <dl className="map-stats">
          <div><dt>{map.nodes.length}</dt><dd>业务节点</dd></div>
          <div><dt>{map.edges.length}</dt><dd>业务路径</dd></div>
          <div><dt>{map.evidence.length}</dt><dd>代码证据</dd></div>
          <div><dt>{map.uncertainties.length}</dt><dd>待确认项</dd></div>
        </dl>
        <section className="detail-section">
          <h3>使用方式</h3>
          <p>选择节点查看完整上下游；选择连线查看触发条件。搜索可以定位业务词、源码文件和证据内容。</p>
        </section>
      </aside>
    );
  }

  if (selection.type === "edge") {
    const edge = map.edges.find((item) => item.id === selection.id);
    if (!edge) return null;
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    return (
      <aside className="detail-panel">
        <div className="eyebrow">业务路径</div>
        <h2>{from?.label} → {to?.label}</h2>
        <div className={`large-status status-${edge.status}`}>{statusMeta[edge.status]?.label ?? edge.status}</div>
        <section className="detail-section">
          <h3>触发条件</h3>
          <p>{edge.guard || edge.label || "没有标注额外条件"}</p>
          <div className="confidence">置信度 {Math.round(edge.confidence * 100)}%</div>
        </section>
        <EvidenceList ids={edge.evidenceIds} />
        <section className="detail-section">
          <h3>路径端点</h3>
          <button className="path-button" onClick={() => onSelectNode(edge.from)}>起点 · {from?.label}</button>
          <button className="path-button" onClick={() => onSelectNode(edge.to)}>终点 · {to?.label}</button>
        </section>
      </aside>
    );
  }

  const node = nodeById.get(selection.id);
  if (!node) return null;
  const related = map.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
  return (
    <aside className="detail-panel">
      <div className="eyebrow">{kindMeta[node.kind]?.label ?? node.kind}</div>
      <h2>{node.label}</h2>
      <div className={`large-status status-${node.status}`}>{statusMeta[node.status]?.label ?? node.status}</div>
      <p className="detail-lead">{node.summary}</p>
      <section className="detail-section">
        <h3>相邻业务路径</h3>
        <div className="path-list">
          {related.map((edge) => {
            const nextId = edge.from === node.id ? edge.to : edge.from;
            return (
              <button className="path-button" key={edge.id} onClick={() => onSelectNode(nextId)}>
                <span>{edge.from === node.id ? "→" : "←"}</span>
                <span>{nodeById.get(nextId)?.label}</span>
                <small>{edge.guard || edge.label || "直接进入"}</small>
              </button>
            );
          })}
        </div>
      </section>
      <EvidenceList ids={node.evidenceIds} />
    </aside>
  );
}

function EvidenceList({ ids }) {
  return (
    <section className="detail-section">
      <h3>可追溯证据</h3>
      <div className="evidence-list">
        {ids.map((id) => {
          const evidence = evidenceById.get(id);
          if (!evidence) return null;
          return (
            <article className="evidence-item" key={id}>
              <div><span className="evidence-kind">{evidence.kind}</span><span>{Math.round(evidence.confidence * 100)}%</span></div>
              <p>{evidence.description}</p>
              {evidence.location && <code>{evidence.location.file}{evidence.location.line ? `:${evidence.location.line}` : ""}</code>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Legend() {
  return (
    <Panel position="top-left" className="legend-panel">
      <div className="legend-title">地图图例</div>
      <div className="legend-subtitle">节点类型</div>
      <div className="kind-legend">
        {Object.entries(kindMeta).map(([kind, meta]) => <span key={kind} className={`kind-key kind-${kind}`}><b>{meta.glyph}</b>{meta.label}</span>)}
      </div>
      <div className="legend-subtitle">证据状态</div>
      <div className="status-legend">
        <span><i className="line fact" />代码事实</span>
        <span><i className="line confirmed" />人工确认</span>
        <span><i className="line inference" />AI 推断</span>
        <span><i className="line unknown" />证据未知</span>
        <span><i className="line conflicted" />证据冲突</span>
      </div>
      <p>颜色表达证据状态，不代表代码是否安全。</p>
    </Panel>
  );
}

function MapCanvas({ selection, setSelection, focusMode }) {
  const [baseNodes, setBaseNodes] = useState([]);
  const { fitView, getZoom, setCenter } = useReactFlow();
  const reachability = useMemo(() => collectFocusedSubgraph(map.edges, selection ?? undefined, focusMode), [selection, focusMode]);

  const centerNode = (node, minimumZoom = 0.82) => {
    if (!node) return;
    const zoom = Math.max(getZoom(), minimumZoom);
    setCenter(node.position.x + (node.width ?? 0) / 2, node.position.y + (node.height ?? 0) / 2, { zoom, duration: 420 });
  };

  useEffect(() => {
    let mounted = true;
    layoutGraph().then((nodes) => {
      if (!mounted) return;
      setBaseNodes(nodes);
      requestAnimationFrame(() => centerNode(nodes[0], 0.82));
    });
    return () => { mounted = false; };
  }, [fitView]);

  const nodes = useMemo(() => baseNodes.map((node) => ({
    ...node,
    selected: selection?.type === "node" && selection.id === node.id,
    className: reachability && !reachability.nodes.has(node.id) ? "is-dimmed" : "is-emphasized",
  })), [baseNodes, selection, reachability]);

  const edges = useMemo(() => map.edges.map((edge) => {
    const active = !reachability || reachability.edges.has(edge.id);
    const edgeColor = ({ fact: "#58635e", confirmed: "#37699b", inference: "#a76a20", unknown: "#77736a", conflicted: "#b1443f" })[edge.status] ?? "#58635e";
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: "smoothstep",
      label: edge.guard || edge.label,
      data: { businessEdge: edge },
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: edgeColor },
      className: `evidence-${edge.status} ${active ? "is-emphasized" : "is-dimmed"}`,
      selected: selection?.type === "edge" && selection.id === edge.id,
      labelShowBg: true,
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 3,
      labelStyle: { fontSize: 11, fontWeight: 650 },
      labelBgStyle: { fill: "#fffdf8", fillOpacity: 0.96 },
      selectable: true,
    };
  }), [reachability, selection]);

  useEffect(() => {
    if (!selection || !baseNodes.length) return;
    if (selection.type === "node") {
      requestAnimationFrame(() => centerNode(baseNodes.find((node) => node.id === selection.id)));
      return;
    }
    const selectedEdge = map.edges.find((edge) => edge.id === selection.id);
    const source = baseNodes.find((node) => node.id === selectedEdge?.from);
    const target = baseNodes.find((node) => node.id === selectedEdge?.to);
    if (source && target) {
      const x = (source.position.x + (source.width ?? 0) / 2 + target.position.x + (target.width ?? 0) / 2) / 2;
      const y = (source.position.y + (source.height ?? 0) / 2 + target.position.y + (target.height ?? 0) / 2) / 2;
      requestAnimationFrame(() => setCenter(x, y, { zoom: Math.max(getZoom(), 0.72), duration: 420 }));
    }
  }, [selection?.type, selection?.id, baseNodes.length]);

  const miniMapColor = (node) => ({
    actor: "#7b6aa8", scenario: "#375f8b", action: "#31715f", decision: "#a16b2b",
    state: "#4d7290", system: "#667080", outcome: "#477a4d", side_effect: "#8b6570",
  })[node.type] ?? "#777";

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={(changes) => setBaseNodes((current) => applyNodeChanges(changes, current))}
      onNodeClick={(_, node) => setSelection({ type: "node", id: node.id })}
      onEdgeClick={(_, edge) => setSelection({ type: "edge", id: edge.id })}
      onPaneClick={() => setSelection(null)}
      minZoom={0.08}
      maxZoom={2}
      nodesConnectable={false}
      nodesDraggable
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="#c8c5bc" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={miniMapColor} maskColor="rgba(244, 242, 235, .78)" />
      <Legend />
      <Panel position="top-right" className="canvas-actions">
        <button onClick={() => centerNode(baseNodes[0], 0.82)}>回到起点</button>
        <button onClick={() => fitView({ padding: 0.16, duration: 480 })}>查看全景</button>
      </Panel>
      {selection && reachability && (
        <Panel position="bottom-center" className="focus-summary">
          已聚焦 {reachability.nodes.size} 个节点 / {reachability.edges.size} 条路径
          <button onClick={() => setSelection(null)}>退出聚焦</button>
        </Panel>
      )}
    </ReactFlow>
  );
}

function App() {
  const [selection, setSelection] = useState(null);
  const [focusMode, setFocusMode] = useState("full");
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return [];
    return map.nodes.filter((node) => {
      const evidenceText = node.evidenceIds.map((id) => {
        const evidence = evidenceById.get(id);
        return `${evidence?.description ?? ""} ${evidence?.location?.file ?? ""}`;
      }).join(" ");
      return `${node.label} ${node.summary} ${kindMeta[node.kind]?.label ?? node.kind} ${evidenceText}`.toLowerCase().includes(value);
    }).slice(0, 10);
  }, [query]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        setSelection(null);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectNode = (id) => {
    setSelection({ type: "node", id });
    setQuery("");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand">CODE DOCTOR</span>
          <div><h1>{map.title}</h1><p>{map.focus}</p></div>
        </div>
        <div className="topbar-actions">
          <div className="search-box">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索业务、源码或证据…" aria-label="搜索业务地图" />
            {query && <div className="search-results">
              {results.length ? results.map((node) => (
                <button key={node.id} onClick={() => selectNode(node.id)}>
                  <span className={`result-kind kind-${node.kind}`}>{kindMeta[node.kind]?.glyph}</span>
                  <span><b>{node.label}</b><small>{kindMeta[node.kind]?.label} · {statusMeta[node.status]?.label}</small></span>
                </button>
              )) : <p>没有找到对应业务节点</p>}
            </div>}
          </div>
          <div className="mode-switch" aria-label="链路聚焦范围">
            {[{ id: "full", label: "完整链路" }, { id: "upstream", label: "问题从哪来" }, { id: "downstream", label: "会影响哪里" }].map((mode) => (
              <button className={focusMode === mode.id ? "active" : ""} key={mode.id} onClick={() => setFocusMode(mode.id)}>{mode.label}</button>
            ))}
          </div>
        </div>
      </header>
      <main className="workspace">
        <section className="canvas-shell">
          <ReactFlowProvider>
            <MapCanvas selection={selection} setSelection={setSelection} focusMode={focusMode} />
          </ReactFlowProvider>
        </section>
        <DetailPanel selection={selection} onSelectNode={selectNode} />
      </main>
    </div>
  );
}

createRoot(document.getElementById("code-doctor-map-root")).render(<App />);
