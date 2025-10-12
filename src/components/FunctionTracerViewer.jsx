import React, { useMemo, useState, useEffect } from "react";
import ReactFlow, { Background, Controls, MiniMap, Position, Handle } from "reactflow";
import "reactflow/dist/style.css";
import "./FunctionTraceViewer.css";

// --- Utilities ---
const asNumber = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

const normalizeTrace = (trace) =>
  trace
    .filter(Boolean)
    .map((e, i) => ({
      ...e,
      index: i,
      type: typeof e.type === "string" ? e.type.toLowerCase() : e.type,
      depth: asNumber(e.depth),
      time: asNumber(e.t, i)
    }))
    .sort((a, b) =>
      a.time !== b.time
        ? a.time - b.time
        : a.depth !== b.depth
        ? a.depth - b.depth
        : a.index - b.index
    );

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
        // orphan exit
        roots.push({ id: `orphan-exit-${event.index}`, enter: null, exit: event, children: [], orphan: true });
      } else {
        call.exit = event;
      }
      continue;
    }
    // other event type – attach as child event node
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
    // DO NOT collapse custom classes; show full shape
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

function trimPath(file) {
  if (!file) return "unknown";
  const parts = String(file)
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.slice(-3).join("/");
}

function fmtDur(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const d = end - start;
  if (d < 0) return null;
  if (d < 1) return (d * 1000).toFixed(2) + " µs";
  if (d < 1000) return d.toFixed(2) + " ms";
  return (d / 1000).toFixed(2) + " s";
}

function truncate(value, limit) {
  if (value.length <= limit) return value;
  return value.slice(0, limit - 1) + "…";
}

function formatValue(value, { limit = 160, multiline = false } = {}) {
  const raw = safeStringify(value, multiline ? 2 : 0);
  if (raw === "—") return raw;
  if (raw.length <= limit || limit === Infinity) return raw;
  return truncate(raw, limit);
}

function formatArgsSignature(args, limit) {
  if (!args || args.length === 0) return "()";
  if (!Array.isArray(args)) {
    const preview = formatValue(args, { limit });
    return `(${preview})`;
  }
  const previews = args.map((arg) => formatValue(arg, { limit: Math.max(24, limit / Math.max(1, args.length)) }));
  return `(${previews.join(", ")})`;
}

// global for simple duration bar scaling
const eventsGlobal = { maxDur: 0 };

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

  useEffect(() => {
    if (compact) setShowDetails(false);
  }, [compact]);

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

  const timelineValue = Number.isFinite(enter.time) && Number.isFinite(exit.time) ? `${enter.time} → ${exit.time}` : null;

  const durationRatio = enter && exit && eventsGlobal.maxDur ? Math.min(1, Math.max(0, (exit.time - enter.time) / eventsGlobal.maxDur)) : 0;

  const detailArgs = !isEvent && enter.args && enter.args.length > 0 ? formatValue(enter.args, { limit: showFull ? Infinity : 600, multiline: true }) : null;
  const detailReturn = exit && Object.prototype.hasOwnProperty.call(exit, "returnValue") ? formatValue(exit.returnValue, { limit: showFull ? Infinity : 600, multiline: true }) : null;
  const detailError = exit && (exit.error || exit.threw) ? formatValue(exit.error ?? exit.returnValue, { limit: showFull ? Infinity : 600, multiline: true }) : null;
  const detailEvent = isEvent ? formatValue(enter, { limit: showFull ? Infinity : 600, multiline: true }) : null;

  return (
    <li className="trace-node" data-depth={depth}>
      <div className={`trace-card${compact ? " is-compact" : ""}${isError ? " is-error" : ""}${isEvent ? " is-event" : ""}`}>
        <div className="trace-card-header">
          {hasChildren ? (
            <button
              type="button"
              className="tree-toggle"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse children" : "Expand children"}
            >
              <span>{expanded ? "▾" : "▸"}</span>
            </button>
          ) : (
            <span className="tree-toggle placeholder" aria-hidden>
              <span>•</span>
            </span>
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

      {hasChildren && expanded && (
        <ul className="trace-children">
          {call.children.map((child) => (
            <CallNode key={child.id} call={child} depth={depth + 1} compact={compact} showFull={showFull} />
          ))}
        </ul>
      )}
    </li>
  );
}

const LAYOUT = {
  columnWidth: 280,
  rowHeight: 180,
  nodeWidth: 240,
  nodeHeight: 130
};

function buildGraphLayout(callRoots) {
  const nodes = [];
  const edges = [];
  let order = 0;

  const assign = (node, depth, parentId) => {
    const enter = node.enter || {};
    const exit = node.exit || {};
    const name = enter.fn || exit.fn || (node.isEventOnly ? enter.type || "event" : "(anonymous)");
    const isEvent = Boolean(node.isEventOnly);
    const isError = Boolean(exit?.error || exit?.threw);
    const duration = enter && exit ? fmtDur(enter.time, exit.time) : null;
    const resultPreview = isEvent
      ? formatValue(enter, { limit: 80 })
      : exit?.threw
      ? `throw ${formatValue(exit.error ?? exit.returnValue, { limit: 80 })}`
      : "returnValue" in exit
      ? formatValue(exit.returnValue, { limit: 80 })
      : exit
      ? "void"
      : "…";
    const argsPreview = isEvent ? null : formatArgsSignature(enter.args, 80);
    const locationFile = enter.file || exit.file;
    const locationLine = enter.line ?? exit.line;
    const location = locationFile ? `${trimPath(locationFile)}${locationLine != null ? ":" + locationLine : ""}` : null;

    nodes.push({
      id: node.id,
      type: "traceNode",
      position: {
        x: depth * LAYOUT.columnWidth,
        y: order * LAYOUT.rowHeight
      },
      data: {
        enter,
        exit,
        isEvent,
        isError,
        name,
        argsPreview,
        resultPreview,
        duration,
        location
      }
    });

    const currentId = node.id;
    order += 1;

    if (parentId) {
      edges.push({
        id: `${parentId}->${currentId}`,
        source: parentId,
        target: currentId,
        type: "smoothstep",
        sourceHandle: "out",
        targetHandle: "in"
      });
    }

    for (const child of node.children || []) assign(child, depth + 1, currentId);
  };

  for (const root of callRoots) assign(root, 0, null);

  return { nodes, edges };
}

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();

    const matchesNode = (node) => {
      const enter = node.enter || {};
      const exit = node.exit || {};
      const fn = (enter.fn || exit.fn || "").toLowerCase();
      const file = (enter.file || exit.file || "").toLowerCase();
      return !needle || fn.includes(needle) || file.includes(needle);
    };

    const prune = (nodes) => {
      const result = [];
      for (const node of nodes) {
        if (hideEvents && node.isEventOnly) continue;

        const childResults = prune(node.children || []);
        const includeSelf = matchesNode(node);

        if (!includeSelf && childResults.length === 0) continue;

        result.push({
          ...node,
          children: childResults
        });
      }
      return result;
    };

    return prune(calls);
  }, [calls, q, hideEvents]);

  const graph = useMemo(() => buildGraphLayout(filtered), [filtered]);
  const nodeTypes = useMemo(() => ({ traceNode: TraceFlowNode }), []);

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
          <label className="toggle">
            <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
            <span>Compact view</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={hideEvents} onChange={(e) => setHideEvents(e.target.checked)} />
            <span>Hide event-only</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showFull} onChange={(e) => setShowFull(e.target.checked)} />
            <span>Show full values</span>
          </label>
        </div>
      </div>

      <div className="trace-toolbar">
        <div className="view-toggle" role="tablist" aria-label="Select trace visualization">
          <button
            type="button"
            className={viewMode === "structured" ? "is-active" : ""}
            onClick={() => setViewMode("structured")}
            role="tab"
            aria-selected={viewMode === "structured"}
          >
            Structured tree
          </button>
          <button
            type="button"
            className={viewMode === "graph" ? "is-active" : ""}
            onClick={() => setViewMode("graph")}
            role="tab"
            aria-selected={viewMode === "graph"}
          >
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
          <TraceGraphView graph={graph} nodeTypes={nodeTypes} />
        )}
      </div>
    </div>
  );
}

function TraceGraphView({ graph, nodeTypes }) {
  return (
    <div className="trace-graph-wrapper" style={{ width: "100%", height: "100%", minHeight: "420px" }}>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
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
        <Background color="rgba(90, 176, 255, 0.12)" gap={32} />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(7, 9, 12, 0.86)"
          nodeColor={(node) => (node.data?.isEvent ? "#8f9eff" : "#5ab0ff")}
        />
        <Controls position="top-right" showInteractive={false} />
      </ReactFlow>

      {graph.nodes.length === 0 && <div className="trace-graph-empty">No trace events</div>}
    </div>
  );
}

function TraceFlowNode({ data }) {
  const { isEvent, isError, name, argsPreview, resultPreview, duration, location, exit, enter } = data;

  return (
    <div className={`graph-node-card${isError ? " is-error" : ""}${isEvent ? " is-event" : ""}`}>
      <Handle type="target" id="in" position={Position.Left} style={{ opacity: 0 }} />
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
        </div>
      </div>
      {isEvent && <span className="event-badge">{enter?.type}</span>}
      <Handle type="source" id="out" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
