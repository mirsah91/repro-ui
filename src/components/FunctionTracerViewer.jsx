// FunctionTraceViewer.jsx
import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import ReactFlow, { Background, Controls, MiniMap, Handle, Position } from "reactflow";
import "reactflow/dist/style.css";
import "./FunctionTraceViewer.css";

/* ============================== Utilities ============================== */
const asNumber = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);

// NOTE: keep original event order — DO NOT sort.
const normalizeTrace = (trace) =>
    trace
        .filter(Boolean)
        .map((e, i) => ({
          ...e,
          index: i,
          type: typeof e.type === "string" ? e.type.toLowerCase() : e.type,
          depth: asNumber(e.depth),
          time: asNumber(e.t, i)
        }));

function buildCallTree(events) {
  const stack = [];
  const roots = [];
  for (const event of events) {
    if (event.type === "enter") {
      const call = { id: `call-${event.index}`, enter: event, exit: null, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(call);
      else roots.push(call);
      stack.push(call);
      continue;
    }
    if (event.type === "exit") {
      const call = stack.pop();
      if (!call) {
        roots.push({ id: `orphan-exit-${event.index}`, enter: null, exit: event, children: [], orphan: true });
      } else {
        call.exit = event;
      }
      continue;
    }
    const node = { id: `event-${event.index}`, enter: event, exit: null, children: [], isEventOnly: true };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
  }
  return roots;
}

function replacer(_k, v) {
  if (typeof v === "function") return "[Function]";
  if (typeof v === "bigint") return String(v) + "n";
  if (v && typeof v === "object") {
    if (v.__type === "Buffer" && Number.isFinite(v.length)) return `[Buffer ${v.length}]`;
  }
  return v;
}

function safeStringify(value, space = 0) {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "function") return "[Function]";
  try {
    return JSON.stringify(value, replacer, space);
  } catch {
    return String(value);
  }
}

const trimPath = (file) =>
    !file ? "unknown" : String(file).split(/[\\/]/).filter(Boolean).slice(-3).join("/");

function fmtDur(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const d = end - start;
  if (d < 0) return null;
  if (d < 1) return (d * 1000).toFixed(2) + " µs";
  if (d < 1000) return d.toFixed(2) + " ms";
  return (d / 1000).toFixed(2) + " s";
}

const truncate = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

function formatValue(value, { limit = 160, multiline = false } = {}) {
  const raw = safeStringify(value, multiline ? 2 : 0);
  if (raw === "—") return raw;
  return raw.length <= limit || limit === Infinity ? raw : truncate(raw, limit);
}

function formatArgsSignature(args, limit) {
  if (!args || args.length === 0) return "()";
  if (!Array.isArray(args)) return `(${formatValue(args, { limit })})`;
  const previews = args.map((arg) =>
      formatValue(arg, { limit: Math.max(24, limit / Math.max(1, args.length)) })
  );
  return `(${previews.join(", ")})`;
}

const eventsGlobal = { maxDur: 0 };

/* ============================ Structured view =========================== */
function MetaChip({ icon, children }) {
  if (!children) return null;
  return (
      <span className="trace-chip">
      {icon && <span className="trace-chip-icon">{icon}</span>}
        {children}
    </span>
  );
}

function DetailBlock({ label, value }) {
  if (value == null) return null;
  return (
      <div className="trace-detail-block">
        <label>{label}</label>
        <pre>{value}</pre>
      </div>
  );
}

function CallNode({ call, depth, compact, showFull }) {
  const enter = call.enter || {};
  const exit = call.exit || {};
  const name = enter.fn || exit.fn || (call.isEventOnly ? enter.type || "event" : "(anonymous)");
  const locationFile = enter.file || exit.file;
  const locationLine = enter.line ?? exit.line;
  const location = locationFile ? `${trimPath(locationFile)}${locationLine != null ? ":" + locationLine : ""}` : null;
  const duration = enter && exit ? fmtDur(enter.time, exit.time) : null;
  const hasChildren = (call.children || []).length > 0;
  const isError = Boolean(exit?.error || exit?.threw);
  const isEvent = Boolean(call.isEventOnly);
  const callTag = !isEvent ? enter?.type : null;

  const [expanded, setExpanded] = useState(depth < 1);
  const [showDetails, setShowDetails] = useState(!compact && depth < 1);
  useEffect(() => { if (compact) setShowDetails(false); }, [compact]);

  const previewLimit = showFull ? Infinity : 120;
  const argsPreview = isEvent ? null : formatArgsSignature(enter.args, previewLimit);
  const resultPreview = isEvent
      ? formatValue(enter, { limit: previewLimit })
      : exit?.threw
          ? `throw ${formatValue(exit.error ?? exit.returnValue, { limit: previewLimit })}`
          : "returnValue" in exit
              ? formatValue(exit.returnValue, { limit: previewLimit })
              : exit
                  ? "void"
                  : "…";

  const timelineValue =
      Number.isFinite(enter.time) && Number.isFinite(exit.time) ? `${enter.time} → ${exit.time}` : null;

  const durationRatio =
      enter && exit && eventsGlobal.maxDur
          ? Math.min(1, Math.max(0, (exit.time - enter.time) / eventsGlobal.maxDur))
          : 0;

  const detailArgs =
      !isEvent && enter.args && enter.args.length > 0
          ? formatValue(enter.args, { limit: showFull ? Infinity : 600, multiline: true })
          : null;
  const detailReturn =
      exit && Object.prototype.hasOwnProperty.call(exit, "returnValue")
          ? formatValue(exit.returnValue, { limit: showFull ? Infinity : 600, multiline: true })
          : null;
  const detailError =
      exit && (exit.error || exit.threw)
          ? formatValue(exit.error ?? exit.returnValue, { limit: showFull ? Infinity : 600, multiline: true })
          : null;
  const detailEvent = isEvent ? formatValue(enter, { limit: showFull ? Infinity : 600, multiline: true }) : null;

  return (
      <li className="trace-node" data-depth={depth}>
        <div className={`trace-card${compact ? " is-compact" : ""}${isError ? " is-error" : ""}${isEvent ? " is-event" : ""}${call.ghost ? " is-ghost" : ""}`}>
          <div className="trace-card-header">
            {hasChildren ? (
                <button type="button" className="tree-toggle" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? "Collapse children" : "Expand children"}>
                  <span>{expanded ? "▾" : "▸"}</span>
                </button>
            ) : (
                <span className="tree-toggle placeholder" aria-hidden><span>•</span></span>
            )}

            <div className="trace-body">
              <div className="trace-signature">
                {!isEvent && <span className="keyword">function</span>}
                <span className="fn-name">{name}</span>
                {!isEvent && <span className="args">{argsPreview}</span>}
                {!isEvent && callTag && <span className="call-tag">{callTag}</span>}
                <span className="arrow">⇒</span>
                <span className={`return${exit?.threw ? " is-throw" : ""}`}>{resultPreview}</span>
                {isEvent && enter?.type && <span className="event-badge">{enter.type}</span>}
                {call.ghost && <span className="event-badge ghost">collapsed</span>}
              </div>

              <div className="trace-meta">
                <MetaChip icon="⏱">{duration}</MetaChip>
                <MetaChip icon="📍">{location}</MetaChip>
                <MetaChip icon="🧭">{timelineValue}</MetaChip>
                {isError && <MetaChip icon="⚠️">{exit.threw ? "threw" : "error"}</MetaChip>}
              </div>

              {durationRatio > 0 && (
                  <div className="trace-bar" role="presentation">
                    <div className="trace-bar-fill" style={{ transform: `scaleX(${durationRatio || 0})` }} />
                  </div>
              )}

              {!compact && (detailArgs || detailReturn || detailError || detailEvent) && (
                  <div className="trace-actions">
                    <button type="button" onClick={() => setShowDetails((v) => !v)} className="detail-toggle">
                      {showDetails ? "Hide details" : "Show details"}
                    </button>
                  </div>
              )}

              {!compact && showDetails && (
                  <div className="trace-details">
                    {detailArgs && <DetailBlock label="Arguments" value={detailArgs} />}
                    {detailReturn && <DetailBlock label="Return value" value={detailReturn} />}
                    {detailError && <DetailBlock label={exit.threw ? "Thrown" : "Error"} value={detailError} />}
                    {detailEvent && <DetailBlock label="Event payload" value={detailEvent} />}
                  </div>
              )}
            </div>
          </div>
        </div>

        {(call.children || []).length > 0 && expanded && (
            <ul className="trace-children">
              {call.children.map((child) => (
                  <CallNode key={child.id} call={child} depth={depth + 1} compact={compact} showFull={showFull} />
              ))}
            </ul>
        )}
      </li>
  );
}

/* =============================== Graph view ============================== */
const LAYOUT = { columnWidth: 280, rowHeight: 180, nodeWidth: 240, nodeHeight: 130 };

function buildGraphLayout(callRoots, { pack = true } = {}) {
  const allNodes = [];
  const allEdges = [];
  for (const root of callRoots) {
    let order = 0; // vertical order within this root follows encounter order
    const assign = (node, depth, parentId) => {
      const enter = node.enter || {};
      const exit = node.exit || {};
      const isEvent = Boolean(node.isEventOnly);
      const isError = Boolean((node.exit || {})?.error || (node.exit || {})?.threw);
      const name = enter.fn || exit.fn || (isEvent ? enter.type || "event" : "(anonymous)");
      const duration = enter && exit ? fmtDur(enter.time, exit.time) : null;
      const resultPreview = isEvent
          ? formatValue(enter, { limit: 80 })
          : exit?.threw
              ? `throw ${formatValue(exit.error ?? exit.returnValue, { limit: 80 })}`
              : "returnValue" in (exit || {})
                  ? formatValue(exit.returnValue, { limit: 80 })
                  : exit
                      ? "void"
                      : "…";
      const argsPreview = isEvent ? null : formatArgsSignature(enter.args, 80);
      const locationFile = enter.file || exit.file;
      const locationLine = enter.line ?? exit.line;
      const location = locationFile ? `${trimPath(locationFile)}${locationLine != null ? ":" + locationLine : ""}` : null;

      allNodes.push({
        id: node.id,
        type: "traceNode",
        position: { x: depth * LAYOUT.columnWidth, y: order * LAYOUT.rowHeight },
        data: { enter, exit, isEvent, isError, name, argsPreview, resultPreview, duration, location, ghost: !!node.ghost }
      });

      const currentId = node.id;
      order += 1;

      if (parentId) allEdges.push({ id: `${parentId}->${currentId}`, source: parentId, target: currentId, type: "smoothstep" });
      for (const child of node.children || []) assign(child, depth + 1, currentId);
    };
    assign(root, 0, null);
  }

  // components by connectivity
  const adj = new Map();
  const addAdj = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  };
  for (const e of allEdges) addAdj(e.source, e.target);
  for (const n of allNodes) if (!adj.has(n.id)) adj.set(n.id, new Set());

  const idToNode = new Map(allNodes.map((n) => [n.id, n]));
  const visited = new Set();
  const components = [];

  for (const n of allNodes) {
    if (visited.has(n.id)) continue;
    const queue = [n.id], ids = [];
    visited.add(n.id);
    while (queue.length) {
      const cur = queue.shift();
      ids.push(cur);
      for (const nb of adj.get(cur) || []) if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
    }
    const compNodes = ids.map((id) => idToNode.get(id));
    const setIds = new Set(ids);
    const compEdges = allEdges.filter((e) => setIds.has(e.source) && setIds.has(e.target));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cn of compNodes) {
      minX = Math.min(minX, cn.position.x);
      minY = Math.min(minY, cn.position.y);
      maxX = Math.max(maxX, cn.position.x + (cn.measured?.width ?? LAYOUT.nodeWidth));
      maxY = Math.max(maxY, cn.position.y + (cn.measured?.height ?? LAYOUT.nodeHeight));
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    const anchor = [...compNodes].sort((a, b) =>
        a.position.y !== b.position.y ? a.position.y - b.position.y : a.position.x - b.position.x
    )[0];

    components.push({
      width,
      height,
      nodes: compNodes.map((cn) => ({ ...cn, position: { x: cn.position.x - minX, y: cn.position.y - minY } })),
      edges: compEdges,
      anchorId: anchor?.id
    });
  }

  if (components.length <= 1 || !pack) {
    return { nodes: allNodes, edges: allEdges, components: components.map((c, i) => ({ index: i, id: `comp-${i}`, anchorId: c.anchorId })) };
  }

  // pack disconnected components visually
  const GAP_X = 120, GAP_Y = 140;
  const maxW = Math.max(...components.map((c) => c.width));
  const maxH = Math.max(...components.map((c) => c.height));
  const cellW = maxW + GAP_X;
  const cellH = maxH + GAP_Y;
  const cols = Math.ceil(Math.sqrt(components.length));

  const nodes = [], edges = [];
  components.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const offX = col * cellW + (cellW - c.width) / 2;
    const offY = row * cellH + (cellH - c.height) / 2;
    nodes.push(...c.nodes.map((n) => ({ ...n, position: { x: n.position.x + offX, y: n.position.y + offY } })));
    edges.push(...c.edges);
  });

  return { nodes, edges, components: components.map((c, i) => ({ index: i, id: `comp-${i}`, anchorId: c.anchorId })) };
}

/* ======================= Custom Node & NodeTypes ======================== */
function TraceFlowNodeView({ data }) {
  const { isEvent, isError, name, argsPreview, resultPreview, duration, location, exit, enter, ghost } = data;
  return (
      <div className={`graph-node-card${isError ? " is-error" : ""}${isEvent ? " is-event" : ""}${ghost ? " is-ghost" : ""}`}>
        <Handle type="target" position={Position.Left} id="in" />
        <Handle type="source" position={Position.Right} id="out" />
        <div className="graph-node-head">
          {!isEvent && <span className="keyword">function</span>}
          <span className="fn-name">{name}</span>
          {!isEvent && <span className="args">{argsPreview}</span>}
        </div>
        <div className="graph-node-body">
          <div className="graph-node-return">
            <span className="arrow">⇒</span>
            <span className={`return${exit?.threw ? " is-throw" : ""}`}>{resultPreview}</span>
          </div>
          <div className="graph-node-meta">
            {duration && <span>⏱ {duration}</span>}
            {location && <span>📍 {location}</span>}
            {ghost && <span className="ghost-pill">collapsed</span>}
          </div>
        </div>
        {isEvent && <span className="event-badge">{enter?.type}</span>}
      </div>
  );
}

// singleton nodeTypes to avoid React Flow warning #002
const NODE_TYPES = (() => {
  if (!globalThis.__FUNCTION_TRACE_NODE_TYPES__) {
    globalThis.__FUNCTION_TRACE_NODE_TYPES__ = Object.freeze({ traceNode: TraceFlowNodeView });
  }
  return globalThis.__FUNCTION_TRACE_NODE_TYPES__;
})();

/* ======================== Graph View & Controls ========================= */
const btnStyle = (isLight) => ({
  border: isLight ? "1px solid rgba(0,0,0,0.12)" : "1px solid rgba(255,255,255,0.16)",
  background: isLight ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.35)",
  color: isLight ? "#111" : "white",
  padding: "6px 10px",
  borderRadius: 8,
  cursor: "pointer"
});

function TraceGraphView({ graph }) {
  const wrapperRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [localNodes, setLocalNodes] = useState(graph.nodes);
  const [localEdges, setLocalEdges] = useState(graph.edges);
  const [components, setComponents] = useState(graph.components || []);
  const [focusedId, setFocusedId] = useState(null);
  const [compIndex, setCompIndex] = useState(0);
  const [q, setQ] = useState("");
  const [theme, setTheme] = useState("light");
  const [autoFocused, setAutoFocused] = useState(false);

  useEffect(() => {
    setLocalNodes(graph.nodes);
    setLocalEdges(graph.edges);
    setComponents(graph.components || []);
    setCompIndex(0);
    setAutoFocused(false);
  }, [graph]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      setReady(width > 0 && height > 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const instanceRef = useRef(null);
  const onInit = useCallback((inst) => { instanceRef.current = inst; }, []);

  const focusNode = useCallback((id) => {
    const node = localNodes.find((n) => n.id === id);
    if (!node) return;
    setFocusedId(id);
    setLocalNodes((prev) =>
        prev.map((n) => ({
          ...n,
          className:
              n.id === id
                  ? `${(n.className || "").replace(/\bis-focused\b/g, "").trim()} is-focused`
                  : (n.className || "").replace(/\bis-focused\b/g, "").trim()
        }))
    );
    const w = node?.measured?.width ?? 240;
    const h = node?.measured?.height ?? 130;
    instanceRef.current?.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1.1, duration: 450 });
  }, [localNodes]);

  // Auto focus first component’s anchor
  useEffect(() => {
    if (!ready || autoFocused || !instanceRef.current || localNodes.length === 0) return;
    const anchor = components[0]?.anchorId || localNodes[0]?.id;
    let r1 = 0, r2 = 0;
    r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => { focusNode(anchor); setAutoFocused(true); }); });
    return () => { if (r1) cancelAnimationFrame(r1); if (r2) cancelAnimationFrame(r2); };
  }, [ready, autoFocused, localNodes, components, focusNode]);

  const goToComponent = useCallback((idx) => {
    if (!components.length) return;
    const clamped = (idx + components.length) % components.length;
    setCompIndex(clamped);
    focusNode(components[clamped].anchorId);
  }, [components, focusNode]);

  const onFind = useCallback((e) => {
    e?.preventDefault?.();
    const needle = q.trim().toLowerCase();
    if (!needle) return;
    const scored = localNodes
        .map((n) => {
          const d = n.data || {};
          const name = (d.name || "").toLowerCase();
          const file = (d.location || "").toLowerCase();
          let score = 0;
          if (name.includes(needle)) score += 2;
          if (file.includes(needle)) score += 1;
          if (name.startsWith(needle)) score += 2;
          return { id: n.id, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);
    if (scored.length) focusNode(scored[0].id);
  }, [q, localNodes, focusNode]);

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === "/" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        const input = wrapperRef.current?.querySelector(".graph-find-input");
        if (input) { ev.preventDefault(); input.focus(); input.select(); }
      }
      if (ev.key === "Escape") {
        setFocusedId(null);
        setLocalNodes((prev) => prev.map((n) => ({ ...n, className: (n.className || "").replace(/\bis-focused\b/g, "").trim() })));
      }
      if (ev.key === "Enter") {
        const active = document.activeElement;
        if (active && active.classList.contains("graph-find-input")) onFind();
      }
      if (ev.key === "ArrowRight" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) goToComponent(compIndex + 1);
      if (ev.key === "ArrowLeft" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) goToComponent(compIndex - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onFind, goToComponent, compIndex]);

  const isLight = theme === "light";
  const wrapperBg = isLight ? "#ffffff" : "#0e1116";
  const gridColor = isLight ? "rgba(0,0,0,0.06)" : "rgba(90,176,255,0.12)";
  const maskColor = isLight ? "rgba(255,255,255,0.86)" : "rgba(7, 9, 12, 0.86)";
  const miniMapNodeColor = (node) =>
      node.data?.isEvent ? (isLight ? "#6c79ff" : "#8f9eff") : (isLight ? "#2f77d1" : "#5ab0ff");

  return (
      <div ref={wrapperRef} className="trace-graph-wrapper"
           style={{ width: "100%", height: "100%", minHeight: 420, position: "relative", background: wrapperBg }}>
        <form onSubmit={onFind} className="graph-toolbar" style={{
          position: "absolute", top: 8, left: 8, zIndex: 10, display: "flex", gap: 8, alignItems: "center",
          background: isLight ? "rgba(255,255,255,0.8)" : "rgba(20,22,27,0.65)", backdropFilter: "blur(6px)",
          borderRadius: 12, padding: "6px 8px",
          border: isLight ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(255,255,255,0.12)"
        }}>
          <input className="graph-find-input" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Find node by function or file (press /)"
                 style={{ border: isLight ? "1px solid rgba(0,0,0,0.12)" : "1px solid rgba(255,255,255,0.16)",
                   outline: "none", background: isLight ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.2)",
                   color: isLight ? "#111" : "white", padding: "6px 10px", borderRadius: 8, minWidth: 280 }} />
          <button type="submit" title="Jump to first match (Enter)" style={btnStyle(isLight)}>Jump</button>
          <button type="button" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
                  title="Toggle background" style={btnStyle(isLight)}>
            {isLight ? "Dark" : "Light"}
          </button>
          {components.length > 1 && (
              <>
                <span style={{ marginLeft: 6, color: isLight ? "#111" : "white", opacity: 0.75 }}>Components:</span>
                <button type="button" onClick={() => goToComponent(compIndex - 1)} title="Previous component (←)" style={btnStyle(isLight)}>◀</button>
                <span style={{ color: isLight ? "#111" : "white", opacity: 0.85, fontSize: 12 }}>{compIndex + 1}/{components.length}</span>
                <button type="button" onClick={() => goToComponent(compIndex + 1)} title="Next component (→)" style={btnStyle(isLight)}>▶</button>
              </>
          )}
          {focusedId && <span style={{ color: isLight ? "#111" : "white", opacity: 0.85, fontSize: 12 }}>Focused: <code>{focusedId}</code> (Esc to clear)</span>}
        </form>

        {ready ? (
            <ReactFlow
                nodes={localNodes}
                edges={localEdges}
                nodeTypes={NODE_TYPES}
                onInit={onInit}
                minZoom={0.35}
                maxZoom={2.4}
                nodesDraggable={false}
                nodesConnectable={false}
                nodesFocusable={false}
                elementsSelectable={false}
                zoomOnDoubleClick={false}
                panOnDrag
                panOnScroll
                className="trace-graph-flow"
                proOptions={{ hideAttribution: true }}
            >
              <Background color={gridColor} gap={32} />
              <MiniMap pannable zoomable maskColor={maskColor} nodeColor={miniMapNodeColor} />
              <Controls position="top-right" showInteractive={false} />
            </ReactFlow>
        ) : (
            <div className="trace-graph-empty" style={{ inset: 0, position: "absolute", display: "grid", placeItems: "center" }}>
              Preparing graph…
            </div>
        )}
      </div>
  );
}

/* ============================== Wrapper ================================ */
export function FunctionTraceViewer({ trace = [], title = "Function trace" }) {
  const events = useMemo(() => normalizeTrace(trace), [trace]);
  const calls = useMemo(() => buildCallTree(events), [events]);

  // compute max duration among matched enter/exit for bar scaling
  eventsGlobal.maxDur = 0;
  for (const root of calls) {
    const walk = (node) => {
      if (node.enter && node.exit) {
        eventsGlobal.maxDur = Math.max(eventsGlobal.maxDur, (node.exit.time - node.enter.time) || 0);
      }
      (node.children || []).forEach(walk);
    };
    walk(root);
  }

  const [q, setQ] = useState("");
  const [compact, setCompact] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [hideEvents, setHideEvents] = useState(true);
  const [viewMode, setViewMode] = useState("structured");

  // CONNECTIVITY-SAFE FILTER: keep ancestors as ghost bridge nodes
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matchesNode = (node) => {
      const enter = node.enter || {};
      const exit = node.exit || {};
      const fn = (enter.fn || exit.fn || "").toLowerCase();
      const file = (enter.file || exit.file || "").toLowerCase();
      return !needle || fn.includes(needle) || file.includes(needle);
    };

    const prune = (node) => {
      const kids = (node.children || []).map(prune).filter(Boolean);
      const keepSelf = (!hideEvents || !node.isEventOnly) && matchesNode(node);
      const keepBecauseChild = kids.length > 0;
      if (keepSelf || keepBecauseChild) {
        return { ...node, children: kids, ghost: !keepSelf && keepBecauseChild };
      }
      return null;
    };

    return calls.map(prune).filter(Boolean);
  }, [calls, q, hideEvents]);

  const graph = useMemo(() => buildGraphLayout(filtered, { pack: true }), [filtered]);

  return (
      <div className="trace-viewer">
        <div className="trace-header">
          <div className="trace-heading">
            <h2>{title}</h2>
            <span className="trace-subhead">{filtered.length} root call{filtered.length === 1 ? "" : "s"}</span>
          </div>
          <div className="trace-controls">
            <div className="input-group">
              <span>🔍</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by function or file" />
            </div>
            {viewMode === "structured" && (
              <label className="toggle">
                <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
                <span>Compact view</span>
              </label>
            )}
            <label className="toggle">
              <input type="checkbox" checked={hideEvents} onChange={(e) => setHideEvents(e.target.checked)} />
              <span>Hide event-only</span>
            </label>
            {viewMode === "structured" && (
              <label className="toggle">
                <input type="checkbox" checked={showFull} onChange={(e) => setShowFull(e.target.checked)} />
                <span>Show full values</span>
              </label>
            )}
          </div>
        </div>

        <div className="trace-toolbar">
          <div className="view-toggle" role="tablist" aria-label="Select trace visualization">
            <button type="button" className={viewMode === "structured" ? "is-active" : ""} onClick={() => setViewMode("structured")} role="tab" aria-selected={viewMode === "structured"}>
              Structured tree
            </button>
            <button type="button" className={viewMode === "graph" ? "is-active" : ""} onClick={() => setViewMode("graph")} role="tab" aria-selected={viewMode === "graph"}>
              Call graph
            </button>
          </div>
        </div>

        <div className="trace-content">
          {viewMode === "structured" ? (
              filtered.length === 0 ? (
                  <div className="trace-empty">No trace events</div>
              ) : (
                  <div className="trace-tree-scroll">
                    <ul className="trace-tree">
                      {filtered.map((call) => (
                          <CallNode key={call.id} call={call} depth={0} compact={compact} showFull={showFull} />
                      ))}
                    </ul>
                  </div>
              )
          ) : (
              <div style={{ height: "70vh" }}>
                <TraceGraphView graph={graph} />
              </div>
          )}
        </div>
      </div>
  );
}

