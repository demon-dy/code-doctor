import fs from "node:fs/promises";
import path from "node:path";
import type { CodeGraph } from "../types.js";
import { ensureOutputDirectory, writeJson } from "../utils.js";

const renderHtml = (graph: CodeGraph): string => {
  const data = JSON.stringify(graph).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Code Doctor 调用图</title>
  <style>
    :root { color-scheme: dark; --bg:#0b0d10; --panel:#13171c; --line:#2b333d; --text:#e8edf2; --muted:#87919d; --accent:#82d4bb; }
    * { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; overflow:hidden }
    header { height:64px; display:flex; align-items:center; gap:20px; padding:12px 18px; border-bottom:1px solid var(--line); background:#0e1115 }
    h1 { margin:0; font:600 17px/1.2 system-ui,sans-serif; letter-spacing:.02em } .stats { color:var(--muted); white-space:nowrap }
    input { width:min(420px,34vw); margin-left:auto; background:var(--panel); border:1px solid var(--line); color:var(--text); padding:9px 12px; border-radius:6px; outline:none }
    input:focus { border-color:var(--accent) }
    main { height:calc(100vh - 64px); display:grid; grid-template-columns:minmax(0,1fr) 340px }
    #canvas { width:100%; height:100%; background-image:linear-gradient(#151a20 1px,transparent 1px),linear-gradient(90deg,#151a20 1px,transparent 1px); background-size:32px 32px }
    aside { border-left:1px solid var(--line); padding:16px; overflow:auto; background:var(--panel) }
    .empty { color:var(--muted) } .title { font:600 18px/1.3 system-ui,sans-serif; overflow-wrap:anywhere }
    .badge { display:inline-block; margin:10px 6px 10px 0; padding:3px 7px; border:1px solid var(--line); border-radius:999px; color:var(--accent); font-size:11px }
    .row { margin:12px 0; padding-top:12px; border-top:1px solid var(--line) } .label { color:var(--muted); font-size:11px; text-transform:uppercase }
    .value { margin-top:4px; overflow-wrap:anywhere } .edge { padding:8px 0; border-bottom:1px solid #20262d; cursor:pointer } .edge:hover { color:var(--accent) }
    svg text { pointer-events:none; fill:var(--text); font-size:10px } .node { cursor:pointer } .node circle { stroke:#0b0d10; stroke-width:2 }
    .node.dim { opacity:.08 } .node.hidden,.link.hidden { display:none } .link { stroke:#42505e; stroke-opacity:.55 } .link.inferred { stroke-dasharray:5 4; stroke:#9a7b55 } .link.dim { opacity:.04 }
  </style>
</head>
<body>
  <header><h1>CODE DOCTOR / 调用图</h1><span class="stats" id="stats"></span><input id="search" placeholder="搜索文件、函数、接口…"></header>
  <main><svg id="canvas"></svg><aside id="detail"><p class="empty">点击节点查看上下游和源码位置。</p></aside></main>
  <script>
    const graph=${data};
    const colors={file:'#536273',function:'#7e8ea3',frontend:'#6cb5a2',endpoint:'#e0a458',handler:'#d47c8b',external:'#8d75b8'};
    const svg=document.querySelector('#canvas'), detail=document.querySelector('#detail'), search=document.querySelector('#search');
    document.querySelector('#stats').textContent=graph.stats.files+' files · '+graph.stats.endpoints+' endpoints · '+graph.stats.edges+' edges';
    const width=()=>svg.clientWidth, height=()=>svg.clientHeight;
    const nodes=graph.nodes.map((node,index)=>({...node,x:80+(index*83)%Math.max(160,width()-160),y:70+(index*47)%Math.max(140,height()-140),vx:0,vy:0}));
    const byId=new Map(nodes.map(node=>[node.id,node]));
    const edges=graph.edges.map(edge=>({...edge,source:byId.get(edge.from),target:byId.get(edge.to)})).filter(edge=>edge.source&&edge.target);
    const largeGraph=nodes.length>500;
    const ns='http://www.w3.org/2000/svg';
    const edgeEls=edges.map(edge=>{const line=document.createElementNS(ns,'line');line.classList.add('link');if(edge.confidence==='inferred')line.classList.add('inferred');svg.append(line);return line});
    const nodeEls=nodes.map(node=>{const group=document.createElementNS(ns,'g');group.classList.add('node');const circle=document.createElementNS(ns,'circle');circle.setAttribute('r',node.kind==='endpoint'?8:6);circle.setAttribute('fill',colors[node.kind]||'#777');const text=document.createElementNS(ns,'text');text.setAttribute('x','10');text.setAttribute('y','4');text.textContent=node.label.length>42?node.label.slice(0,39)+'…':node.label;group.append(circle,text);group.addEventListener('click',()=>show(node));svg.append(group);return group});
    let dragging=null; nodeEls.forEach((el,index)=>el.addEventListener('pointerdown',event=>{dragging=nodes[index];el.setPointerCapture(event.pointerId)}));
    svg.addEventListener('pointermove',event=>{if(!dragging)return;const rect=svg.getBoundingClientRect();dragging.x=event.clientX-rect.left;dragging.y=event.clientY-rect.top;dragging.vx=dragging.vy=0;if(largeGraph)updatePositions()});
    svg.addEventListener('pointerup',()=>dragging=null);
    function updatePositions(){
      edgeEls.forEach((el,index)=>{const edge=edges[index];el.setAttribute('x1',edge.source.x);el.setAttribute('y1',edge.source.y);el.setAttribute('x2',edge.target.x);el.setAttribute('y2',edge.target.y)});
      nodeEls.forEach((el,index)=>el.setAttribute('transform','translate('+nodes[index].x+' '+nodes[index].y+')'));
    }
    function tick(){
      for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],dx=b.x-a.x,dy=b.y-a.y,d2=Math.max(200,dx*dx+dy*dy),f=1300/d2;a.vx-=dx*f*.01;a.vy-=dy*f*.01;b.vx+=dx*f*.01;b.vy+=dy*f*.01}
      edges.forEach(edge=>{const dx=edge.target.x-edge.source.x,dy=edge.target.y-edge.source.y,d=Math.max(1,Math.hypot(dx,dy)),f=(d-95)*.0007;edge.source.vx+=dx*f;edge.source.vy+=dy*f;edge.target.vx-=dx*f;edge.target.vy-=dy*f});
      nodes.forEach(node=>{node.vx+=(width()/2-node.x)*.00008;node.vy+=(height()/2-node.y)*.00008;node.vx*=.88;node.vy*=.88;node.x=Math.max(14,Math.min(width()-14,node.x+node.vx));node.y=Math.max(14,Math.min(height()-14,node.y+node.vy))});
      updatePositions();requestAnimationFrame(tick)
    }
    const overviewIds=()=>{const endpointIds=new Set(nodes.filter(node=>node.kind==='endpoint').map(node=>node.id)),ids=new Set(endpointIds);edges.forEach(edge=>{if(endpointIds.has(edge.from)||endpointIds.has(edge.to)){ids.add(edge.from);ids.add(edge.to)}});if(!ids.size)nodes.filter(node=>node.kind==='file').slice(0,120).forEach(node=>ids.add(node.id));return ids};
    function setLargeGraphVisible(ids){
      const visible=nodes.filter(node=>ids.has(node.id));const kinds=[...new Set(visible.map(node=>node.kind))];const grouped=new Map(kinds.map(kind=>[kind,visible.filter(node=>node.kind===kind)]));
      kinds.forEach((kind,column)=>grouped.get(kind).forEach((node,index,array)=>{node.x=(column+1)*width()/(kinds.length+1);node.y=(index+1)*height()/(array.length+1)}));
      nodeEls.forEach((el,index)=>el.classList.toggle('hidden',!ids.has(nodes[index].id)));edgeEls.forEach((el,index)=>el.classList.toggle('hidden',!ids.has(edges[index].from)||!ids.has(edges[index].to)));updatePositions();
      document.querySelector('#stats').textContent=graph.stats.files+' files · '+graph.stats.endpoints+' endpoints · '+graph.stats.edges+' edges · showing '+visible.length;
    }
    function focus(node){const ids=new Set([node.id]);edges.forEach(edge=>{if(edge.from===node.id||edge.to===node.id){ids.add(edge.from);ids.add(edge.to)}});setLargeGraphVisible(ids)}
    function show(node){if(largeGraph)focus(node);const related=edges.filter(edge=>edge.from===node.id||edge.to===node.id);detail.innerHTML='<div class="title">'+esc(node.label)+'</div><span class="badge">'+node.kind+'</span>'+(node.language?'<span class="badge">'+node.language+'</span>':'')+(node.location?'<div class="row"><div class="label">源码</div><div class="value">'+esc(node.location.file)+(node.location.line?':'+node.location.line:'')+'</div></div>':'')+'<div class="row"><div class="label">上下游 '+related.length+'</div>'+related.map(edge=>{const other=byId.get(edge.from===node.id?edge.to:edge.from);return '<div class="edge" data-id="'+esc(other.id)+'">'+(edge.from===node.id?'→ ':'← ')+esc(other.label)+' <small>'+edge.kind+(edge.confidence==='inferred'?' · inferred':'')+'</small></div>'}).join('')+'</div>';detail.querySelectorAll('[data-id]').forEach(el=>el.addEventListener('click',()=>show(byId.get(el.dataset.id))));}
    function esc(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))}
    search.addEventListener('input',()=>{const value=search.value.toLowerCase();const matches=new Set(nodes.filter(node=>value&&(node.label.toLowerCase().includes(value)||node.id.toLowerCase().includes(value))).map(node=>node.id));if(largeGraph){if(!value)return setLargeGraphVisible(overviewIds());const expanded=new Set(matches);edges.forEach(edge=>{if(matches.has(edge.from)||matches.has(edge.to)){expanded.add(edge.from);expanded.add(edge.to)}});setLargeGraphVisible(expanded)}else{nodeEls.forEach((el,index)=>el.classList.toggle('dim',value&&!matches.has(nodes[index].id)));edgeEls.forEach((el,index)=>el.classList.toggle('dim',value&&!matches.has(edges[index].from)&&!matches.has(edges[index].to)))}});
    if(largeGraph)setLargeGraphVisible(overviewIds());else tick();
  </script>
</body>
</html>`;
};

export const writeGraphArtifacts = async (root: string, graph: CodeGraph): Promise<{
  jsonFile: string;
  htmlFile: string;
}> => {
  const output = await ensureOutputDirectory(root);
  const jsonFile = path.join(output, "graph.json");
  const htmlFile = path.join(output, "graph.html");
  await writeJson(jsonFile, graph);
  await fs.writeFile(htmlFile, renderHtml(graph), "utf8");
  return { jsonFile, htmlFile };
};
