import React, {
  useCallback,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
} from 'react';
import './functionTraceViewer.css';

// --- Utilities -------------------------------------------------------------

const asNumber = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

const normalizeTrace = trace =>
  trace
    .filter(Boolean)
    .map((event, index) => ({
      ...event,
      index,
      type: typeof event.type === 'string' ? event.type.toLowerCase() : event.type,
      depth: asNumber(event.depth),
      time: asNumber(event.t, index),
    }))
    .sort((a, b) =>
      a.time !== b.time
        ? a.time - b.time
        : a.depth !== b.depth
          ? a.depth - b.depth
          : a.index - b.index,
    );

function buildCallTree(events) {
  const stack = [];
  const roots = [];

  for (const event of events) {
    if (event.type === 'enter') {
      const call = { id: `call-${event.index}`, enter: event, exit: null, children: [] };
      if (stack.length) {
        stack[stack.length - 1].children.push(call);
      } else {
        roots.push(call);
      }
      stack.push(call);
      continue;
    }

    if (event.type === 'exit') {
      const call = stack.pop();
      if (!call) {
        roots.push({
          id: `orphan-exit-${event.index}`,
          enter: null,
          exit: event,
          children: [],
          orphan: true,
        });
      } else {
        call.exit = event;
      }
      continue;
    }

    const node = {
      id: `event-${event.index}`,
      enter: event,
      exit: null,
      children: [],
      isEventOnly: true,
    };

    if (stack.length) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function stringifyValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'string') return JSON.stringify(value);

  try {
    return JSON.stringify(value, jsonReplacer, 2);
  } catch (error) {
    return String(error && error.message ? error.message : value);
  }
}

function previewJSON(value, limit = 200) {
  const text = stringifyValue(value);
  if (text.length > limit) {
    return `${text.slice(0, limit)}…`;
  }
  return text;
}

function jsonReplacer(_key, value) {
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'bigint') return `${String(value)}n`;
  if (value && typeof value === 'object') {
    if (value.__type === 'Buffer' && Number.isFinite(value.length)) {
      return `[Buffer ${value.length}]`;
    }
  }
  return value;
}

function trimPath(file) {
  if (!file) return 'unknown';
  const parts = String(file)
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.slice(-3).join('/');
}

function formatDuration(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const delta = end - start;
  if (delta < 0) return null;
  if (delta < 1) return `${(delta * 1000).toFixed(2)} µs`;
  if (delta < 1000) return `${delta.toFixed(2)} ms`;
  return `${(delta / 1000).toFixed(2)} s`;
}

function callDuration(call) {
  const start = call.enter?.time;
  const end = call.exit?.time;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function computeStats(calls) {
  let maxDuration = 0;
  const map = new Map();

  const visit = node => {
    map.set(node.id, node);
    const duration = callDuration(node);
    if (Number.isFinite(duration)) {
      maxDuration = Math.max(maxDuration, duration);
    }
    (node.children || []).forEach(visit);
  };

  calls.forEach(visit);

  return { maxDuration, map };
}

// --- Filtering -------------------------------------------------------------

function matchesNeedle(call, needle) {
  if (!needle) return true;
  const enter = call.enter || {};
  const exit = call.exit || {};
  const fn = String(enter.fn || exit.fn || '').toLowerCase();
  const file = String(enter.file || exit.file || '').toLowerCase();
  return fn.includes(needle) || file.includes(needle);
}

function filterCalls(nodes, { needle, hideEvents }) {
  const result = [];

  for (const node of nodes) {
    const childMatches = filterCalls(node.children || [], { needle, hideEvents });
    const isEventOnly = Boolean(node.isEventOnly);
    const visible = matchesNeedle(node, needle);

    const shouldIncludeSelf = (!hideEvents || !isEventOnly) && visible;
    if (shouldIncludeSelf || childMatches.length) {
      result.push({ node, children: childMatches });
      continue;
    }

    if (!hideEvents && isEventOnly && childMatches.length === 0 && visible) {
      result.push({ node, children: [] });
    }
  }

  return result;
}

// --- Formatting helpers ---------------------------------------------------

function inlinePreview(value, limit = 60) {
  const text = stringifyValue(value).replace(/\s+/g, ' ').trim();
  if (!text) return text;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function formatArgsInline(args) {
  if (!args || args.length === 0) return '';
  if (!Array.isArray(args)) return inlinePreview(args, 60);
  return args
    .map(arg => inlinePreview(arg, 40))
    .join(', ');
}

function formatLocation(call) {
  const enter = call.enter || {};
  const exit = call.exit || {};
  const file = trimPath(enter.file || exit.file);
  const line = enter.line ?? exit.line;
  if (line == null) return file;
  return `${file}:${line}`;
}

function callName(call) {
  const enter = call.enter || {};
  const exit = call.exit || {};
  return enter.fn || exit.fn || '(anonymous)';
}

function hasArgsValue(args) {
  if (args === undefined || args === null) return false;
  if (Array.isArray(args)) return args.length > 0;
  return true;
}

// --- Graph layout helpers --------------------------------------------------

const GRAPH_NODE_WIDTH = 200;
const GRAPH_NODE_HEIGHT = 110;
const GRAPH_HORIZONTAL_SPACING = 240;
const GRAPH_VERTICAL_SPACING = 170;
const GRAPH_PADDING = 80;

function buildGraph(filteredTree) {
  const lookup = new Map();
  const nodes = [];
  const edges = [];
  let leafIndex = 0;

  const visit = (item, depth, parentId) => {
    const node = item.node;
    const childPositions = [];

    item.children.forEach(child => {
      const childY = visit(child, depth + 1, node.id);
      childPositions.push(childY);
    });

    let yIndex;
    if (childPositions.length) {
      const first = childPositions[0];
      const last = childPositions[childPositions.length - 1];
      yIndex = (first + last) / 2;
    } else {
      yIndex = leafIndex;
      leafIndex += 1;
    }

    lookup.set(node.id, node);

    nodes.push({
      id: node.id,
      x: depth * GRAPH_HORIZONTAL_SPACING,
      y: yIndex * GRAPH_VERTICAL_SPACING,
      data: {
        name: callName(node),
        argsInline: formatArgsInline(node.enter?.args),
        durationLabel: formatDuration(node.enter?.time, node.exit?.time),
        returnPreview: node.exit ? previewJSON(node.exit.returnValue, 80) : null,
        location: formatLocation(node),
        isError: Boolean(node.exit?.error || node.exit?.threw),
      },
    });

    if (parentId) {
      edges.push({ from: parentId, to: node.id });
    }

    return yIndex;
  };

  filteredTree.forEach(item => {
    visit(item, 0, null);
    leafIndex += 1;
  });

  if (!nodes.length) {
    return { nodes: [], edges: [], lookup, size: { width: 0, height: 0 } };
  }

  const maxX = Math.max(...nodes.map(n => n.x));
  const maxY = Math.max(...nodes.map(n => n.y));

  return {
    nodes,
    edges,
    lookup,
    size: {
      width: maxX + GRAPH_NODE_WIDTH + GRAPH_PADDING * 2,
      height: maxY + GRAPH_NODE_HEIGHT + GRAPH_PADDING * 2,
    },
  };
}

// --- UI components --------------------------------------------------------

function Toggle({ checked, onChange, label }) {
  return (
    <label className="ftv-toggle">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function ModeSwitch({ value, onChange }) {
  return (
    <div className="ftv-mode-switch">
      <button
        type="button"
        className={value === 'structured' ? 'is-active' : ''}
        onClick={() => onChange('structured')}
      >
        Structured view
      </button>
      <button
        type="button"
        className={value === 'graph' ? 'is-active' : ''}
        onClick={() => onChange('graph')}
      >
        Graph view
      </button>
    </div>
  );
}

function ExpandableValue({ value, showFull, limit = 200 }) {
  const [expanded, setExpanded] = useState(false);
  const fullText = useMemo(() => stringifyValue(value), [value]);
  const truncated = fullText.length > limit ? `${fullText.slice(0, limit)}…` : fullText;
  const shouldTruncate = !showFull && fullText.length > limit;

  return (
    <div className="ftv-expandable">
      <pre>{showFull || !shouldTruncate || expanded ? fullText : truncated}</pre>
      {shouldTruncate && (
        <button type="button" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      )}
    </div>
  );
}

function DetailRow({ label, children, tone }) {
  return (
    <div className={`ftv-detail-row ${tone ? `is-${tone}` : ''}`}>
      <span className="ftv-detail-label">{label}</span>
      <div className="ftv-detail-value">{children}</div>
    </div>
  );
}

function CallBlock({ item, depth, maxDuration, showFullValues }) {
  const { node, children } = item;
  const enter = node.enter || {};
  const exit = node.exit || {};
  const name = callName(node);
  const argsInline = formatArgsInline(enter.args);
  const durationMs = callDuration(node);
  const durationLabel = formatDuration(enter.time, exit.time);
  const returnValue = exit && Object.prototype.hasOwnProperty.call(exit, 'returnValue')
    ? exit.returnValue
    : undefined;
  const isError = Boolean(exit?.error || exit?.threw);
  const location = formatLocation(node);
  const hasChildren = children.length > 0;
  const [open, setOpen] = useState(depth < 1);

  const progress = maxDuration > 0 && Number.isFinite(durationMs)
    ? Math.min(1, Math.max(0, durationMs / maxDuration))
    : 0;

  const hasArgs = hasArgsValue(enter.args);

  return (
    <div className="ftv-call" data-depth={depth} style={{ marginLeft: depth * 24 }}>
      <div className="ftv-call-header">
        <button
          type="button"
          className={`ftv-fold ${open ? 'is-open' : ''}`}
          onClick={() => setOpen(v => !v)}
          aria-label={open ? 'Collapse call' : 'Expand call'}
        />
        <div className="ftv-call-code">
          <div className="ftv-line">
            <span className="ftv-keyword">function</span>{' '}
            <span className="ftv-fn">{name}</span>
            <span className="ftv-paren">(</span>
            <span className="ftv-args">{argsInline || '/* no args */'}</span>
            <span className="ftv-paren">)</span>{' '}
            <span className="ftv-brace">{'{'}</span>
            <span className="ftv-meta">{/* inline meta */}
              <span>{location}</span>
              {durationLabel && <span>{durationLabel}</span>}
              {isError && <span className="ftv-error">threw</span>}
            </span>
          </div>
        </div>
      </div>

      {open && (
        <div className="ftv-call-body">
          <div className="ftv-progress" aria-hidden>
            <div style={{ transform: `scaleX(${progress || 0})` }} />
          </div>
          {!node.isEventOnly && (
            <DetailRow label="Arguments">
              {hasArgs ? (
                <ExpandableValue value={enter.args} showFull={showFullValues} limit={220} />
              ) : (
                <span className="ftv-muted">—</span>
              )}
            </DetailRow>
          )}
          {returnValue !== undefined && (
            <DetailRow label="Return">
              <ExpandableValue value={returnValue} showFull={showFullValues} limit={220} />
            </DetailRow>
          )}
          {exit && (exit.error || exit.threw) && (
            <DetailRow label="Error" tone="danger">
              <ExpandableValue value={exit.error || exit.threw} showFull={showFullValues} limit={220} />
            </DetailRow>
          )}
          {node.isEventOnly && (
            <DetailRow label="Event">
              <ExpandableValue value={node.enter} showFull={showFullValues} limit={220} />
            </DetailRow>
          )}

          {hasChildren && (
            <div className="ftv-children">
              {children.map(child => (
                <CallBlock
                  key={child.node.id}
                  item={child}
                  depth={depth + 1}
                  maxDuration={maxDuration}
                  showFullValues={showFullValues}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="ftv-line ftv-return-line">
        <span className="ftv-brace">{'}'}</span>
        <span className="ftv-return-arrow">→</span>
        <span className="ftv-return-value">
          {returnValue === undefined ? 'void' : previewJSON(returnValue, 80)}
        </span>
      </div>
    </div>
  );
}

function CallTree({ items, maxDuration, showFullValues }) {
  if (!items.length) {
    return <div className="ftv-empty">No trace events</div>;
  }

  return (
    <div className="ftv-tree">
      {items.map(item => (
        <CallBlock
          key={item.node.id}
          item={item}
          depth={0}
          maxDuration={maxDuration}
          showFullValues={showFullValues}
        />
      ))}
    </div>
  );
}

function GraphView({ items, showFullValues }) {
  const { nodes, edges, lookup, size } = useMemo(() => buildGraph(items), [items]);
  const patternBaseId = useId();
  const gridId = useMemo(() => `ftv-grid-${patternBaseId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [patternBaseId]);
  const [selectedId, setSelectedId] = useState(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const stageRef = useRef(null);
  const panRef = useRef({ active: false, pointerId: null, startX: 0, startY: 0, panX: 0, panY: 0, scale: 1 });

  useEffect(() => {
    setViewport({ x: 0, y: 0, scale: 1 });
  }, [items]);

  useEffect(() => {
    if (!nodes.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !lookup.has(selectedId)) {
      setSelectedId(nodes[0].id);
    }
  }, [nodes, lookup, selectedId]);

  const selectedCall = selectedId ? lookup.get(selectedId) : null;

  const transformStyle = useMemo(
    () => ({
      transform: `translate(${GRAPH_PADDING + viewport.x}px, ${GRAPH_PADDING + viewport.y}px) scale(${viewport.scale})`,
      transformOrigin: 'top left',
    }),
    [viewport],
  );

  const handleNodeSelect = useCallback(id => {
    setSelectedId(id);
  }, []);

  const beginPan = useCallback(
    event => {
      if (!nodes.length) return;
      if (event.target?.closest && event.target.closest('.ftv-graph-node')) return;
      event.preventDefault();
      panRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        panX: viewport.x,
        panY: viewport.y,
        scale: viewport.scale,
      };
      stageRef.current?.setPointerCapture?.(event.pointerId);
    },
    [nodes.length, viewport],
  );

  const movePan = useCallback(event => {
    const state = panRef.current;
    if (!state.active || state.pointerId !== event.pointerId) return;
    const dx = (event.clientX - state.startX) / state.scale;
    const dy = (event.clientY - state.startY) / state.scale;
    setViewport(view => ({ ...view, x: state.panX + dx, y: state.panY + dy }));
  }, []);

  const endPan = useCallback(event => {
    const state = panRef.current;
    if (state.active && state.pointerId === event.pointerId) {
      stageRef.current?.releasePointerCapture?.(event.pointerId);
      panRef.current = { ...state, active: false };
    }
  }, []);

  const handleWheel = useCallback(
    event => {
      if (!nodes.length) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.15 : 0.15;
      setViewport(view => {
        const scale = Math.min(2.5, Math.max(0.5, view.scale + delta));
        return { ...view, scale };
      });
    },
    [nodes.length],
  );

  const zoomIn = useCallback(() => {
    setViewport(view => ({ ...view, scale: Math.min(2.5, view.scale + 0.2) }));
  }, []);

  const zoomOut = useCallback(() => {
    setViewport(view => ({ ...view, scale: Math.max(0.5, view.scale - 0.2) }));
  }, []);

  const resetView = useCallback(() => {
    setViewport({ x: 0, y: 0, scale: 1 });
  }, []);

  const nodeMap = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);

  const viewWidth = Math.max(size.width, 600);
  const viewHeight = Math.max(size.height, 420);

  return (
    <div className="ftv-graph-wrapper">
      <div className="ftv-graph-area">
        {nodes.length === 0 ? (
          <div className="ftv-empty">No trace events match the current filters</div>
        ) : (
          <div
            className="ftv-graph-stage"
            ref={stageRef}
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerLeave={endPan}
            onWheel={handleWheel}
            role="presentation"
          >
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${viewWidth} ${viewHeight}`}
              className="ftv-graph-canvas"
            >
              <defs>
                <pattern id={gridId} width="40" height="40" patternUnits="userSpaceOnUse">
                  <rect width="40" height="40" fill="rgba(17, 23, 34, 0.9)" />
                  <path d="M 40 0 L 0 0 0 40" stroke="rgba(67, 80, 120, 0.25)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect
                x="0"
                y="0"
                width={viewWidth}
                height={viewHeight}
                fill={`url(#${gridId})`}
              />
              <g style={transformStyle}>
                {edges.map(edge => {
                  const from = nodeMap.get(edge.from);
                  const to = nodeMap.get(edge.to);
                  if (!from || !to) return null;
                  const startX = from.x + GRAPH_NODE_WIDTH;
                  const startY = from.y + GRAPH_NODE_HEIGHT / 2;
                  const endX = to.x;
                  const endY = to.y + GRAPH_NODE_HEIGHT / 2;
                  const offset = Math.max(80, (endX - startX) / 2);
                  const d = `M ${startX} ${startY} C ${startX + offset} ${startY}, ${endX - offset} ${endY}, ${endX} ${endY}`;
                  return <path key={`${edge.from}-${edge.to}`} d={d} className="ftv-graph-edge" />;
                })}
              </g>
            </svg>
            <div className="ftv-graph-nodes" style={transformStyle}>
              {nodes.map(node => (
                <button
                  key={node.id}
                  type="button"
                  className={`ftv-graph-node ${node.data.isError ? 'is-error' : ''} ${selectedId === node.id ? 'is-selected' : ''}`}
                  style={{ transform: `translate(${node.x}px, ${node.y}px)` }}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => handleNodeSelect(node.id)}
                >
                  <div className="ftv-graph-node-header">
                    <span className="ftv-node-name">{node.data.name}</span>
                    {node.data.durationLabel && <span className="ftv-node-duration">{node.data.durationLabel}</span>}
                  </div>
                  <div className="ftv-node-sub">{node.data.location}</div>
                  {node.data.argsInline && <div className="ftv-node-args">({node.data.argsInline})</div>}
                  {node.data.returnPreview && <div className="ftv-node-return">→ {node.data.returnPreview}</div>}
                </button>
              ))}
            </div>
            <div className="ftv-graph-controls">
              <button type="button" onClick={zoomOut} aria-label="Zoom out">−</button>
              <button type="button" onClick={resetView} aria-label="Reset view">Reset</button>
              <button type="button" onClick={zoomIn} aria-label="Zoom in">+</button>
            </div>
          </div>
        )}
      </div>
      <aside className="ftv-graph-side">
        {selectedCall ? (
          <div>
            <h3>{callName(selectedCall)}</h3>
            <p className="ftv-side-location">{formatLocation(selectedCall)}</p>
            <div className="ftv-side-section">
              <h4>Arguments</h4>
              {hasArgsValue(selectedCall.enter?.args) ? (
                <ExpandableValue value={selectedCall.enter.args} showFull={showFullValues} limit={280} />
              ) : (
                <span className="ftv-muted">—</span>
              )}
            </div>
            <div className="ftv-side-section">
              <h4>Return value</h4>
              {selectedCall.exit && Object.prototype.hasOwnProperty.call(selectedCall.exit, 'returnValue') ? (
                <ExpandableValue value={selectedCall.exit.returnValue} showFull={showFullValues} limit={280} />
              ) : (
                <span className="ftv-muted">void</span>
              )}
            </div>
            {selectedCall.exit && (selectedCall.exit.error || selectedCall.exit.threw) && (
              <div className="ftv-side-section">
                <h4>Error</h4>
                <ExpandableValue value={selectedCall.exit.error || selectedCall.exit.threw} showFull={showFullValues} limit={280} />
              </div>
            )}
          </div>
        ) : (
          <div className="ftv-empty">Select a node to inspect details</div>
        )}
      </aside>
    </div>
  );
}

// --- Main component -------------------------------------------------------

export function FunctionTraceViewer({ trace = [], title = 'Function trace' }) {
  const events = useMemo(() => normalizeTrace(trace), [trace]);
  const calls = useMemo(() => buildCallTree(events), [events]);
  const { maxDuration } = useMemo(() => computeStats(calls), [calls]);

  const [mode, setMode] = useState('structured');
  const [query, setQuery] = useState('');
  const [hideEvents, setHideEvents] = useState(true);
  const [showFullValues, setShowFullValues] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return filterCalls(calls, { needle, hideEvents });
  }, [calls, query, hideEvents]);

  const rootCount = filtered.length;

  return (
    <div className="ftv-root">
      <header className="ftv-header">
        <div>
          <h2>{title}</h2>
          <p>{rootCount} root call{rootCount === 1 ? '' : 's'}</p>
        </div>
        <div className="ftv-controls">
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Filter by function or file"
          />
          <ModeSwitch value={mode} onChange={setMode} />
          <Toggle checked={hideEvents} onChange={setHideEvents} label="Hide event-only" />
          <Toggle checked={showFullValues} onChange={setShowFullValues} label="Show full values" />
        </div>
      </header>

      {mode === 'structured' ? (
        <CallTree items={filtered} maxDuration={maxDuration} showFullValues={showFullValues} />
      ) : (
        <GraphView items={filtered} showFullValues={showFullValues} />
      )}
    </div>
  );
}

