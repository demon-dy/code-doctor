import React, { memo, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getSmoothStepPath,
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./business-map.css";
import { collectFocusedSubgraph } from "../src/business-map/focus.ts";

const map = window.__CODE_DOCTOR_MAP__;
const embedded = Boolean(window.__CODE_DOCTOR_EMBEDDED__);
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

const evidenceKindLabels = {
  source: "源码",
  test: "测试",
  git: "Git 记录",
  runtime: "运行证据",
  human: "人工确认",
  agent: "AI 分析",
};

const pathLabelId = (edgeId) => `__path_label__${edgeId}`;
const edgeHasLabel = (edge) => Boolean(edge.guard || edge.label);
const fallbackChapters = () => {
  const count = Math.max(1, Math.min(8, Math.ceil(map.nodes.length / 6)));
  const size = Math.ceil(map.nodes.length / count);
  return Array.from({ length: count }, (_, index) => map.nodes.slice(index * size, (index + 1) * size))
    .filter((nodes) => nodes.length)
    .map((nodes, index) => ({
      id: `chapter-${index + 1}`,
      title: nodes.length === 1 ? nodes[0].label : `${nodes[0].label}到${nodes.at(-1).label}`,
      summary: `从“${nodes[0].label}”推进到“${nodes.at(-1).label}”的业务阶段。`,
      nodeIds: nodes.map((node) => node.id),
    }));
};
const chapters = Array.isArray(map.chapters) && map.chapters.length ? map.chapters : fallbackChapters();

const createScope = (chapter) => {
  const nodeIds = new Set(chapter.nodeIds);
  const nodes = map.nodes.filter((node) => nodeIds.has(node.id));
  const edges = map.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const connections = edges.flatMap((edge) => edgeHasLabel(edge)
    ? [
      { id: `${edge.id}::in`, from: edge.from, to: pathLabelId(edge.id), businessEdge: edge },
      { id: `${edge.id}::out`, from: pathLabelId(edge.id), to: edge.to, businessEdge: edge },
    ]
    : [{ id: edge.id, from: edge.from, to: edge.to, businessEdge: edge }]);
  return { nodes, edges, connections };
};

const createInitialNodes = (scope) => [
  ...scope.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: 0, y: 0 },
    data: { businessNode: node },
  })),
  ...scope.edges.filter(edgeHasLabel).map((edge) => ({
    id: pathLabelId(edge.id),
    type: "path_label",
    position: { x: 0, y: 0 },
    data: { pathEdge: edge },
    draggable: false,
  })),
];

const layoutGraph = async (currentNodes, connections) => {
  const children = currentNodes.map((node) => ({
    id: node.id,
    width: node.measured?.width ?? 292,
    height: node.measured?.height ?? 132,
  }));
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "92",
      "elk.spacing.nodeNode": "52",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    },
    children,
    edges: connections.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
  });
  const positions = new Map((graph.children ?? []).map((node) => [node.id, node]));
  return currentNodes.map((node) => {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      ...node,
      id: node.id,
      position: { x: position.x ?? 0, y: position.y ?? 0 },
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
      <div className="node-title">{node.label}</div>
      <div className="node-summary">{node.summary}</div>
      <Handle className="business-handle source" type="source" position={Position.Right} />
    </div>
  );
});

const PathLabelNode = memo(({ data, selected }) => {
  const edge = data.pathEdge;
  const status = statusMeta[edge.status] ?? { label: edge.status, short: edge.status };
  return (
    <div className={`path-label-node status-${edge.status} ${selected ? "is-selected" : ""}`} aria-label={`路径条件：${edge.guard || edge.label}，${status.label}`}>
      <Handle className="path-label-handle target" type="target" position={Position.Left} />
      <div className="path-label-heading"><span>路径条件</span><b>{status.short}</b></div>
      <div className="path-label-text">{edge.guard || edge.label}</div>
      <Handle className="path-label-handle source" type="source" position={Position.Right} />
    </div>
  );
});

const nodeTypes = {
  ...Object.fromEntries(Object.keys(kindMeta).map((kind) => [kind, BusinessNode])),
  path_label: PathLabelNode,
};

const BusinessPathEdge = memo(({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style }) => {
  const [edgePath] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 6, offset: 24 });
  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} interactionWidth={24} />;
});

const edgeTypes = { business: BusinessPathEdge };

const evidenceById = new Map(map.evidence.map((item) => [item.id, item]));
const nodeById = new Map(map.nodes.map((item) => [item.id, item]));

function BusinessOverview({ onSelectChapter }) {
  return (
    <section className="business-overview">
      <div className="overview-intro">
        <div className="eyebrow">第一层 · 业务全景</div>
        <h2>先理解业务阶段，再进入执行细节</h2>
        <p>{map.summary}</p>
      </div>
      <div className="chapter-index" aria-label="业务章节">
        {chapters.map((chapter, index) => {
          const chapterNodes = chapter.nodeIds.map((id) => nodeById.get(id)).filter(Boolean);
          const facts = chapterNodes.filter((node) => node.status === "fact" || node.status === "confirmed").length;
          return (
            <button className="chapter-row" key={chapter.id} onClick={() => onSelectChapter(chapter.id)}>
              <span className="chapter-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="chapter-copy">
                <b>{chapter.title}</b>
                <span>{chapter.summary}</span>
                <small>{chapterNodes[0]?.label} <i>→</i> {chapterNodes.at(-1)?.label}</small>
              </span>
              <span className="chapter-meta"><b>{chapterNodes.length}</b> 个节点<br />{facts} 个事实</span>
              <span className="chapter-enter">进入章节 →</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DetailPanel({ selection, chapter, onSelectNode }) {
  if (!selection) {
    const chapterNodes = chapter?.nodeIds.map((id) => nodeById.get(id)).filter(Boolean) ?? [];
    return (
      <aside className="detail-panel">
        <div className="eyebrow">{chapter ? "第二层 · 场景地图" : "项目业务导览"}</div>
        <h2>{chapter?.title ?? map.title}</h2>
        <p className="detail-lead">{chapter?.summary ?? map.summary}</p>
        <dl className="map-stats">
          <div><dt>{chapter ? chapterNodes.length : chapters.length}</dt><dd>{chapter ? "本章节点" : "业务章节"}</dd></div>
          <div><dt>{chapter ? map.edges.filter((edge) => chapter.nodeIds.includes(edge.from) && chapter.nodeIds.includes(edge.to)).length : map.nodes.length}</dt><dd>{chapter ? "本章路径" : "业务节点"}</dd></div>
          <div><dt>{map.evidence.length}</dt><dd>代码证据</dd></div>
          <div><dt>{map.uncertainties.length}</dt><dd>待确认项</dd></div>
        </dl>
        <section className="detail-section">
          <h3>{chapter ? "继续下钻" : "建议阅读顺序"}</h3>
          <p>{chapter ? "选择一个业务节点或路径条件，进入第三层查看完整上下游和代码证据。" : "按章节了解业务推进过程；遇到关心的阶段再进入，不需要从头读完整条执行链。"}</p>
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
          <button className="path-button" onClick={() => onSelectNode(edge.from)}><span>起</span><span>{from?.label}</span><small>路径起点</small></button>
          <button className="path-button" onClick={() => onSelectNode(edge.to)}><span>终</span><span>{to?.label}</span><small>路径终点</small></button>
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
              <div><span className="evidence-kind">{evidenceKindLabels[evidence.kind] ?? "未知证据"}</span><span>{Math.round(evidence.confidence * 100)}%</span></div>
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

function MapCanvas({ chapter, selection, setSelection, onBack }) {
  const scope = useMemo(() => createScope(chapter), [chapter.id]);
  const [baseNodes, setBaseNodes] = useState(() => createInitialNodes(scope));
  const [isLayouted, setIsLayouted] = useState(false);
  const nodesInitialized = useNodesInitialized();
  const { fitView, getZoom, setCenter } = useReactFlow();
  const reachability = useMemo(() => collectFocusedSubgraph(scope.edges, selection ?? undefined, "full"), [scope.edges, selection]);

  const centerNode = (node, minimumZoom = 0.82) => {
    if (!node) return;
    const zoom = Math.max(getZoom(), minimumZoom);
    const width = node.measured?.width ?? node.width ?? 292;
    const height = node.measured?.height ?? node.height ?? 132;
    setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom, duration: 420 });
  };

  useEffect(() => {
    if (!nodesInitialized || isLayouted) return;
    let mounted = true;
    layoutGraph(baseNodes, scope.connections).then((nodes) => {
      if (!mounted) return;
      setBaseNodes(nodes);
      setIsLayouted(true);
      requestAnimationFrame(() => centerNode(nodes[0], 0.82));
    });
    return () => { mounted = false; };
  }, [nodesInitialized, isLayouted]);

  const nodes = useMemo(() => baseNodes.map((node) => {
    const pathEdge = node.data.pathEdge;
    const active = pathEdge ? !reachability || reachability.edges.has(pathEdge.id) : !reachability || reachability.nodes.has(node.id);
    const selected = pathEdge
      ? selection?.type === "edge" && selection.id === pathEdge.id
      : selection?.type === "node" && selection.id === node.id;
    return {
      ...node,
      selected,
      className: !isLayouted ? "is-preparing" : active ? "is-emphasized" : "is-dimmed",
    };
  }), [baseNodes, selection, reachability, isLayouted]);

  const edges = useMemo(() => scope.connections.map((connection) => {
    const edge = connection.businessEdge;
    const active = !reachability || reachability.edges.has(edge.id);
    const edgeColor = ({ fact: "#58635e", confirmed: "#37699b", inference: "#a76a20", unknown: "#77736a", conflicted: "#b1443f" })[edge.status] ?? "#58635e";
    return {
      id: connection.id,
      source: connection.from,
      target: connection.to,
      type: "business",
      data: { businessEdge: edge },
      markerEnd: connection.id.endsWith("::in")
        ? undefined
        : { type: MarkerType.ArrowClosed, width: 18, height: 18, color: edgeColor },
      className: `evidence-${edge.status} ${!isLayouted ? "is-preparing" : active ? "is-emphasized" : "is-dimmed"}`,
      selected: selection?.type === "edge" && selection.id === edge.id,
      selectable: true,
    };
  }), [scope.connections, reachability, selection, isLayouted]);

  useEffect(() => {
    if (!selection || !baseNodes.length) return;
    if (selection.type === "node") {
      requestAnimationFrame(() => centerNode(baseNodes.find((node) => node.id === selection.id)));
      return;
    }
    const labelNode = baseNodes.find((node) => node.id === pathLabelId(selection.id));
    if (labelNode) {
      requestAnimationFrame(() => centerNode(labelNode));
      return;
    }
    const selectedEdge = map.edges.find((edge) => edge.id === selection.id);
    const source = baseNodes.find((node) => node.id === selectedEdge?.from);
    const target = baseNodes.find((node) => node.id === selectedEdge?.to);
    if (source && target) {
      const sourceWidth = source.measured?.width ?? source.width ?? 292;
      const sourceHeight = source.measured?.height ?? source.height ?? 132;
      const targetWidth = target.measured?.width ?? target.width ?? 292;
      const targetHeight = target.measured?.height ?? target.height ?? 132;
      const x = (source.position.x + sourceWidth / 2 + target.position.x + targetWidth / 2) / 2;
      const y = (source.position.y + sourceHeight / 2 + target.position.y + targetHeight / 2) / 2;
      requestAnimationFrame(() => setCenter(x, y, { zoom: Math.max(getZoom(), 0.72), duration: 420 }));
    }
  }, [selection?.type, selection?.id, baseNodes.length, isLayouted]);

  const miniMapColor = (node) => ({
    actor: "#7b6aa8", scenario: "#375f8b", action: "#31715f", decision: "#a16b2b",
    state: "#4d7290", system: "#667080", outcome: "#477a4d", side_effect: "#8b6570", path_label: "#c6bda9",
  })[node.type] ?? "#777";

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={(changes) => setBaseNodes((current) => applyNodeChanges(changes, current))}
      onNodeClick={(_, node) => node.data.pathEdge
        ? setSelection({ type: "edge", id: node.data.pathEdge.id })
        : setSelection({ type: "node", id: node.id })}
      onEdgeClick={(_, edge) => setSelection({ type: "edge", id: edge.data.businessEdge.id })}
      onPaneClick={() => setSelection(null)}
      minZoom={0.08}
      maxZoom={2}
      panOnScroll
      panOnScrollMode="free"
      panOnScrollSpeed={0.72}
      zoomOnScroll={false}
      zoomOnPinch
      zoomActivationKeyCode="Meta"
      panOnDrag
      preventScrolling
      nodesConnectable={false}
      nodesDraggable
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="#c8c5bc" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={miniMapColor} maskColor="rgba(244, 242, 235, .78)" />
      <Legend />
      <Panel position="top-right" className="canvas-actions">
        <span className="gesture-hint">双指平移 · 捏合缩放</span>
        <button onClick={onBack}>返回业务全景</button>
        <button disabled={!isLayouted} onClick={() => centerNode(baseNodes[0], 0.82)}>回到起点</button>
        <button disabled={!isLayouted} onClick={() => fitView({ padding: 0.16, duration: 480 })}>查看全景</button>
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
  const [chapterId, setChapterId] = useState(() => embedded ? chapters[0]?.id ?? null : null);
  const [query, setQuery] = useState("");
  const chapter = chapters.find((item) => item.id === chapterId) ?? null;

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
        if (selection) setSelection(null);
        else setChapterId(null);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection]);

  const selectNode = (id) => {
    const ownerChapter = chapters.find((item) => item.nodeIds.includes(id));
    if (ownerChapter) setChapterId(ownerChapter.id);
    setSelection({ type: "node", id });
    setQuery("");
  };

  const selectChapter = (id) => {
    setChapterId(id);
    setSelection(null);
  };

  const showOverview = () => {
    setChapterId(null);
    setSelection(null);
  };

  return (
    <div className={`app-shell ${embedded ? "is-embedded" : ""}`}>
      <header className="topbar">
        <div className="brand-block">
          <span className="brand">CODE DOCTOR</span>
          <div><h1>{map.title}</h1><p>{map.focus}</p></div>
        </div>
        <nav className="level-nav" aria-label="业务地图层级">
          <button className={!chapter ? "active" : ""} onClick={showOverview}>业务全景</button>
          <span>›</span>
          <button className={chapter ? "active" : ""} disabled={!chapter}>{chapter?.title ?? "选择章节"}</button>
          <span>›</span>
          <span className={selection ? "active" : ""}>{selection ? "链路与证据" : "选择节点"}</span>
        </nav>
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
        </div>
      </header>
      <main className="workspace">
        <section className="canvas-shell">
          {chapter ? (
            <ReactFlowProvider key={chapter.id}>
              <MapCanvas chapter={chapter} selection={selection} setSelection={setSelection} onBack={showOverview} />
            </ReactFlowProvider>
          ) : <BusinessOverview onSelectChapter={selectChapter} />}
        </section>
        <DetailPanel selection={selection} chapter={chapter} onSelectNode={selectNode} />
      </main>
    </div>
  );
}

const mapHost = window.__CODE_DOCTOR_MAP_HOST__ ?? document.getElementById("code-doctor-map-root");
window.__CODE_DOCTOR_ACTIVE_MAP_ROOT__?.unmount();
const activeRoot = createRoot(mapHost);
window.__CODE_DOCTOR_ACTIVE_MAP_ROOT__ = activeRoot;
activeRoot.render(<App />);
