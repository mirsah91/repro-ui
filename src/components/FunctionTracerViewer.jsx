import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./FunctionTracerViewer.css";

const DEFAULT_VISIBLE_DEPTH = 4;

const BASE_TYPE_META = {
  enter: { label: "Enter", color: "#2563eb" },
  leave: { label: "Leave", color: "#dc2626" },
  exit: { label: "Exit", color: "#dc2626" },
  error: { label: "Error", color: "#f97316" },
  info: { label: "Info", color: "#0ea5e9" },
  unknown: { label: "Unknown", color: "#6b7280" },
};

function toTitleCase(value) {
  if (!value) return "Unknown";
  return value
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)([a-z])/g, (match) => match.toUpperCase());
}

function ensureDepth(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildTraceTree(trace) {
  const root = [];
  const stack = [];

  trace.forEach((rawItem, index) => {
    const depth = ensureDepth(rawItem.depth, stack.length);
    const item = { ...rawItem, depth };
    const node = {
      id: `${index}`,
      index,
      item,
      children: [],
      totalDescendants: 0,
    };

    while (stack.length && ensureDepth(stack[stack.length - 1].item.depth, 0) >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  });

  root.forEach((node) => annotateNode(node));

  return root;
}

function annotateNode(node) {
  let descendants = 0;
  node.children.forEach((child) => {
    descendants += 1 + annotateNode(child);
  });
  node.totalDescendants = descendants;
  return descendants;
}

function filterTraceTree(nodes, predicate, maxDepth) {
  return nodes.reduce((accumulator, node) => {
    const depth = ensureDepth(node.item.depth, 0);
    const withinDepth = maxDepth === Infinity || depth <= maxDepth;

    if (!withinDepth) {
      return accumulator;
    }

    const filteredChildren = filterTraceTree(node.children, predicate, maxDepth);
    const matches = predicate(node.item);

    if (matches || filteredChildren.length > 0) {
      const visibleDescendants = filteredChildren.reduce(
        (sum, child) => sum + 1 + (child.visibleDescendants || 0),
        0,
      );

      const filteredNode = {
        ...node,
        matches,
        children: filteredChildren,
        visibleDescendants,
        hiddenChildren: Math.max(node.totalDescendants - visibleDescendants, 0),
      };

      accumulator.push(filteredNode);
    }

    return accumulator;
  }, []);
}

function flattenTree(nodes, accumulator = []) {
  nodes.forEach((node) => {
    accumulator.push(node);
    flattenTree(node.children, accumulator);
  });
  return accumulator;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 100 ? 2 : 1)} s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)} min`;
  return `${(ms / 3600000).toFixed(1)} h`;
}

function inferLanguageFromFile(filePath) {
  if (!filePath) return "text";
  const match = /\.([^.\s]+)$/.exec(filePath);
  if (!match) return "text";
  const extension = match[1].toLowerCase();
  const map = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    py: "python",
    rb: "ruby",
    java: "java",
    go: "go",
    rs: "rust",
    php: "php",
    html: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    md: "markdown",
    sh: "shell",
    bash: "shell",
    yml: "yaml",
    yaml: "yaml",
    c: "c",
    h: "c",
    cpp: "cpp",
    cxx: "cpp",
    cc: "cpp",
    cs: "csharp",
    swift: "swift",
    kt: "kotlin",
    m: "objective-c",
    mm: "objective-c",
  };
  return map[extension] || extension;
}

function normalizeSourcePayload(payload, item) {
  if (payload == null) return null;

  const fallbackHighlight = Number.isFinite(Number(item?.line)) ? Number(item.line) : null;
  const fallbackLanguage = inferLanguageFromFile(item?.file);

  if (typeof payload === "string") {
    return {
      content: payload,
      language: fallbackLanguage,
      startLine: 1,
      highlightLine: fallbackHighlight,
    };
  }

  if (Array.isArray(payload)) {
    return {
      content: payload.join("\n"),
      language: fallbackLanguage,
      startLine: 1,
      highlightLine: fallbackHighlight,
    };
  }

  if (typeof payload === "object") {
    const rawContent =
      typeof payload.content === "string"
        ? payload.content
        : typeof payload.code === "string"
        ? payload.code
        : Array.isArray(payload.lines)
        ? payload.lines.join("\n")
        : "";

    const startLine = Number.isFinite(Number(payload.startLine))
      ? Math.max(1, Number(payload.startLine))
      : 1;

    const highlightLine = Number.isFinite(Number(payload.highlightLine))
      ? Number(payload.highlightLine)
      : fallbackHighlight;

    const language =
      typeof payload.language === "string" && payload.language.trim()
        ? payload.language
        : fallbackLanguage;

    return {
      content: rawContent,
      language,
      startLine,
      highlightLine,
    };
  }

  return null;
}

function formatTimestamp(value) {
  if (!Number.isFinite(value)) return "-";
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  } catch (error) {
    return `${value}`;
  }
}

function highlightMatch(text, query) {
  if (!query || !text) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const segments = [];
  let searchIndex = 0;
  let matchIndex = lowerText.indexOf(lowerQuery, searchIndex);
  let key = 0;

  while (matchIndex !== -1) {
    if (matchIndex > searchIndex) {
      segments.push(text.slice(searchIndex, matchIndex));
    }

    segments.push(
      <mark className="trace-node__highlight" key={`mark-${key}`}>
        {text.slice(matchIndex, matchIndex + query.length)}
      </mark>,
    );

    key += 1;
    searchIndex = matchIndex + query.length;
    matchIndex = lowerText.indexOf(lowerQuery, searchIndex);
  }

  if (searchIndex < text.length) {
    segments.push(text.slice(searchIndex));
  }

  return segments;
}

function buildTypeMeta(trace) {
  const meta = { ...BASE_TYPE_META };
  trace.forEach((item) => {
    if (!item || !item.type) return;
    if (!meta[item.type]) {
      meta[item.type] = {
        label: toTitleCase(item.type),
        color: "#6b7280",
      };
    }
  });
  return meta;
}

function FunctionTracerViewer({ trace = [], loadSource = null }) {
  const sortedTrace = useMemo(
    () =>
      [...trace]
        .filter(Boolean)
        .sort((a, b) => ensureDepth(a.t, 0) - ensureDepth(b.t, 0))
        .map((item, index) => ({ ...item, index })),
    [trace],
  );

  const typeMeta = useMemo(() => buildTypeMeta(sortedTrace), [sortedTrace]);
  const typeKeys = useMemo(() => Object.keys(typeMeta), [typeMeta]);

  const [searchTerm, setSearchTerm] = useState("");
  const [showTimeline, setShowTimeline] = useState(true);
  const [collapsedNodes, setCollapsedNodes] = useState(() => new Set());
  const [depthLimitEnabled, setDepthLimitEnabled] = useState(true);
  const [depthLimit, setDepthLimit] = useState(DEFAULT_VISIBLE_DEPTH);
  const [activeTypes, setActiveTypes] = useState(() => new Set(typeKeys));
  const [selectedNodeIndex, setSelectedNodeIndex] = useState(null);
  const [sourceCache, setSourceCache] = useState({});
  const sourceCacheRef = useRef(sourceCache);

  useEffect(() => {
    setActiveTypes((previous) => {
      const next = new Set(previous);
      let changed = false;
      typeKeys.forEach((type) => {
        if (!next.has(type)) {
          next.add(type);
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [typeKeys]);

  const maxDepthInTrace = useMemo(
    () =>
      sortedTrace.reduce((maxDepth, item) => {
        const depth = ensureDepth(item.depth, 0);
        return depth > maxDepth ? depth : maxDepth;
      }, 0),
    [sortedTrace],
  );

  useEffect(() => {
    if (depthLimit > maxDepthInTrace && depthLimitEnabled) {
      setDepthLimit(Math.max(maxDepthInTrace, 1));
    }
  }, [depthLimit, depthLimitEnabled, maxDepthInTrace]);

  const traceTree = useMemo(() => buildTraceTree(sortedTrace), [sortedTrace]);

  const effectiveDepthLimit = depthLimitEnabled ? depthLimit : Infinity;

  const activeTypeSet = activeTypes;
  const query = searchTerm.trim().toLowerCase();

  const filteredTree = useMemo(() => {
    const predicate = (item) => {
      if (!item) return false;
      const type = item.type || "unknown";
      if (!activeTypeSet.has(type)) return false;
      if (!query) return true;

      const haystacks = [item.fn, item.file, item.type]
        .filter(Boolean)
        .map((value) => `${value}`.toLowerCase());

      return haystacks.some((value) => value.includes(query));
    };

    return filterTraceTree(traceTree, predicate, effectiveDepthLimit);
  }, [activeTypeSet, effectiveDepthLimit, query, traceTree]);

  const flattenedVisibleNodes = useMemo(
    () => flattenTree(filteredTree, []),
    [filteredTree],
  );

  useEffect(() => {
    if (!flattenedVisibleNodes.length) {
      if (selectedNodeIndex !== null) {
        setSelectedNodeIndex(null);
      }
      return;
    }

    const exists = flattenedVisibleNodes.some(
      (node) => node.item.index === selectedNodeIndex,
    );

    if (!exists) {
      setSelectedNodeIndex(flattenedVisibleNodes[0].item.index);
    }
  }, [flattenedVisibleNodes, selectedNodeIndex]);

  useEffect(() => {
    sourceCacheRef.current = sourceCache;
  }, [sourceCache]);

  const totalEvents = sortedTrace.length;
  const visibleEvents = flattenedVisibleNodes.length;
  const hiddenEvents = Math.max(totalEvents - visibleEvents, 0);

  const uniqueFunctions = useMemo(() => {
    const unique = new Set();
    sortedTrace.forEach((item) => {
      if (item.fn) {
        unique.add(item.fn);
      }
    });
    return unique;
  }, [sortedTrace]);

  const visibleFunctions = useMemo(() => {
    const unique = new Set();
    flattenedVisibleNodes.forEach((node) => {
      if (node.item && node.item.fn) {
        unique.add(node.item.fn);
      }
    });
    return unique;
  }, [flattenedVisibleNodes]);

  const [minTime, maxTime] = useMemo(() => {
    if (!sortedTrace.length) return [NaN, NaN];
    const first = sortedTrace[0].t;
    const last = sortedTrace[sortedTrace.length - 1].t;
    return [Number(first), Number(last)];
  }, [sortedTrace]);

  const durationMap = useMemo(() => {
    const map = new Map();
    sortedTrace.forEach((item, index) => {
      const next = sortedTrace[index + 1];
      const duration = next ? Math.max(Number(next.t) - Number(item.t), 1) : 1;
      map.set(item.index, duration);
    });
    return map;
  }, [sortedTrace]);

  const timeRange = Number.isFinite(minTime) && Number.isFinite(maxTime) ? maxTime - minTime || 1 : 1;

  const handleToggleType = (type) => {
    setActiveTypes((previous) => {
      const next = new Set(previous);
      if (next.has(type)) {
        if (next.size === 1) return previous;
        next.delete(type);
        return new Set(next);
      }
      next.add(type);
      return new Set(next);
    });
  };

  const handleToggleCollapse = (nodeId) => {
    setCollapsedNodes((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const resetFilters = () => {
    setSearchTerm("");
    setActiveTypes(new Set(typeKeys));
    setDepthLimit(DEFAULT_VISIBLE_DEPTH);
    setDepthLimitEnabled(true);
    setCollapsedNodes(new Set());
  };

  const handleSelectNode = useCallback((index) => {
    setSelectedNodeIndex(index);
  }, []);

  const updateSourceCache = useCallback((updater) => {
    setSourceCache((previous) => {
      const next =
        typeof updater === "function" ? updater(previous) : updater || {};
      sourceCacheRef.current = next;
      return next;
    });
  }, []);

  const startLoadSource = useCallback(
    (item, cacheKey) => {
      if (!item || !cacheKey || typeof loadSource !== "function") {
        return () => {};
      }

      let cancelled = false;

      updateSourceCache((previous) => ({
        ...previous,
        [cacheKey]: { status: "loading" },
      }));

      Promise.resolve()
        .then(() => loadSource(item))
        .then((result) => {
          if (cancelled) return;
          updateSourceCache((previous) => ({
            ...previous,
            [cacheKey]: { status: "success", data: result },
          }));
        })
        .catch((error) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          updateSourceCache((previous) => ({
            ...previous,
            [cacheKey]: { status: "error", error: message },
          }));
        });

      return () => {
        cancelled = true;
      };
    },
    [loadSource, updateSourceCache],
  );

  const selectedNode = useMemo(() => {
    if (selectedNodeIndex === null) return null;
    return (
      flattenedVisibleNodes.find((node) => node.item.index === selectedNodeIndex) ||
      null
    );
  }, [flattenedVisibleNodes, selectedNodeIndex]);

  const selectedItem = selectedNode?.item;
  const selectedType = selectedItem?.type || "unknown";
  const selectedTypeMeta = selectedItem
    ? typeMeta[selectedType] || { label: toTitleCase(selectedType), color: "#6b7280" }
    : null;

  const inlineSource = useMemo(() => {
    if (!selectedItem) return null;
    if (selectedItem.source) return selectedItem.source;
    if (selectedItem.code) return selectedItem.code;
    if (selectedItem.snippet) return selectedItem.snippet;
    if (Array.isArray(selectedItem.lines)) {
      return { lines: selectedItem.lines, startLine: selectedItem.startLine };
    }
    return null;
  }, [selectedItem]);

  const inlineSourceNormalized = useMemo(
    () => normalizeSourcePayload(inlineSource, selectedItem),
    [inlineSource, selectedItem],
  );

  const cacheKey = selectedItem?.file ? `${selectedItem.file}` : null;
  const cachedEntry = cacheKey ? sourceCache[cacheKey] : null;
  const cachedSourceNormalized = useMemo(() => {
    if (!cachedEntry || cachedEntry.status !== "success") return null;
    return normalizeSourcePayload(cachedEntry.data, selectedItem);
  }, [cachedEntry, selectedItem]);

  const activeSource = inlineSourceNormalized || cachedSourceNormalized;
  const isLoadingSource = Boolean(
    !inlineSourceNormalized && cachedEntry && cachedEntry.status === "loading",
  );
  const sourceError = !inlineSourceNormalized && cachedEntry?.status === "error"
    ? cachedEntry.error
    : null;

  useEffect(() => {
    if (!cacheKey || inlineSourceNormalized || typeof loadSource !== "function") {
      return undefined;
    }

    if (sourceCacheRef.current[cacheKey]) {
      return undefined;
    }

    return startLoadSource(selectedItem, cacheKey);
  }, [cacheKey, inlineSourceNormalized, loadSource, selectedItem, startLoadSource]);

  const handleReloadSource = useCallback(() => {
    if (!selectedItem || !cacheKey) return;
    startLoadSource(selectedItem, cacheKey);
  }, [cacheKey, selectedItem, startLoadSource]);

  const highlightedLineRef = useRef(null);
  const assignHighlightedLine = useCallback((node) => {
    highlightedLineRef.current = node;
  }, []);

  const renderNode = (node, depth, path) => {
    const nodeId = `${path.join(".")}-${node.id}`;
    const type = node.item.type || "unknown";
    const meta = typeMeta[type] || { label: toTitleCase(type), color: "#6b7280" };
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsedNodes.has(nodeId);
    const isSelected = node.item.index === selectedNodeIndex;
    const indentation = depth * 1.25;
    const timestamp = Number(node.item.t);
    const relativeTime = Number.isFinite(timestamp) && Number.isFinite(minTime) ? timestamp - minTime : NaN;
    const duration = durationMap.get(node.item.index) || 1;
    const widthPercentage = Math.min(Math.max((duration / timeRange) * 100, 0.35), 100);
    const startPercentage = Number.isFinite(relativeTime) ? ((relativeTime / timeRange) * 100).toFixed(3) : 0;

    return (
      <div className="trace-node" key={nodeId}>
        <div
          className={`trace-node__row${node.matches ? " trace-node__row--match" : ""}${
            isSelected ? " trace-node__row--selected" : ""
          }`}
          style={{ paddingLeft: `${indentation}rem` }}
          role="button"
          tabIndex={0}
          aria-selected={isSelected}
          onClick={(event) => {
            handleSelectNode(node.item.index);
            if (event.currentTarget && typeof event.currentTarget.focus === "function") {
              event.currentTarget.focus();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleSelectNode(node.item.index);
            }
          }}
        >
          <div className="trace-node__main">
            {hasChildren ? (
              <button
                type="button"
                className="trace-node__toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  handleToggleCollapse(nodeId);
                }}
                aria-label={isCollapsed ? "Expand" : "Collapse"}
                aria-expanded={!isCollapsed}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
            ) : (
              <span className="trace-node__spacer" />
            )}
            <span
              className="trace-node__type-indicator"
              style={{ backgroundColor: meta.color }}
              title={meta.label}
            />
            <div className="trace-node__content">
              <div className="trace-node__title">
                <span className="trace-node__name" title={node.item.fn || "Anonymous function"}>
                  {highlightMatch(node.item.fn || "anonymous", query)}
                </span>
                <span className="trace-node__type" style={{ color: meta.color }}>
                  {meta.label}
                </span>
                <span className="trace-node__depth">Depth {ensureDepth(node.item.depth, 0)}</span>
              </div>
              <div className="trace-node__meta">
                {node.item.file ? (
                  <span className="trace-node__location" title={node.item.file}>
                    {highlightMatch(
                      `${node.item.file}${node.item.line ? `:${node.item.line}` : ""}`,
                      query,
                    )}
                  </span>
                ) : (
                  <span className="trace-node__location">—</span>
                )}
                <span className="trace-node__time" title={Number.isFinite(timestamp) ? formatTimestamp(timestamp) : "Unknown"}>
                  {Number.isFinite(relativeTime) ? `${formatDuration(relativeTime)} from start` : "—"}
                </span>
                {showTimeline && Number.isFinite(timestamp) ? (
                  <span className="trace-node__timeline" aria-hidden="true">
                    <span
                      className="trace-node__timeline-bar"
                      style={{
                        backgroundColor: meta.color,
                        marginLeft: `${startPercentage}%`,
                        width: `${widthPercentage}%`,
                      }}
                    />
                  </span>
                ) : null}
              </div>
            </div>
            {hasChildren ? (
              <span className="trace-node__badge" title="Visible descendant calls">
                {node.visibleDescendants}
              </span>
            ) : (
              <span className="trace-node__badge trace-node__badge--empty">0</span>
            )}
            {node.hiddenChildren > 0 ? (
              <span className="trace-node__hidden" title="Hidden by filters or depth">
                +{node.hiddenChildren}
              </span>
            ) : null}
          </div>
        </div>
        {hasChildren && !isCollapsed ? (
          <div className="trace-node__children">
            {node.children.map((child, childIndex) =>
              renderNode(child, depth + 1, [...path, `${childIndex}`]),
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const selectedTimestamp = selectedItem ? Number(selectedItem.t) : NaN;
  const selectedRelativeTime =
    Number.isFinite(selectedTimestamp) && Number.isFinite(minTime)
      ? selectedTimestamp - minTime
      : NaN;
  const selectedDuration = selectedItem
    ? durationMap.get(selectedItem.index) || null
    : null;
  const selectedDepth = ensureDepth(selectedItem?.depth, 0);
  const selectedFileLabel = selectedItem?.file
    ? `${selectedItem.file}${selectedItem.line ? `:${selectedItem.line}` : ""}`
    : null;
  const highlightLineNumber = Number.isFinite(Number(activeSource?.highlightLine))
    ? Number(activeSource.highlightLine)
    : Number.isFinite(Number(selectedItem?.line))
    ? Number(selectedItem.line)
    : null;
  const codeStartLine = Number.isFinite(Number(activeSource?.startLine))
    ? Number(activeSource.startLine)
    : 1;
  const codeLines = activeSource
    ? activeSource.content.split(/\r?\n/)
    : [];
  const codeLanguage = activeSource?.language || inferLanguageFromFile(selectedItem?.file);
  const hasHighlightLine = Number.isFinite(highlightLineNumber);

  useEffect(() => {
    if (highlightedLineRef.current) {
      highlightedLineRef.current.scrollIntoView({ block: "center" });
    }
  }, [activeSource?.content, highlightLineNumber, selectedNodeIndex]);

  return (
    <div className="trace-viewer">
      <div className="trace-toolbar">
        <div className="trace-toolbar__controls">
          <div className="trace-toolbar__search">
            <label htmlFor="trace-search" className="trace-toolbar__label">
              Search
            </label>
            <input
              id="trace-search"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Function, file, or type"
              className="trace-toolbar__input"
            />
          </div>
          <div className="trace-toolbar__filters">
            <span className="trace-toolbar__label">Event types</span>
            <div className="trace-toolbar__chip-group">
              {typeKeys.map((type) => {
                const meta = typeMeta[type];
                const isActive = activeTypeSet.has(type);
                return (
                  <button
                    key={type}
                    type="button"
                    className={`trace-toolbar__chip${isActive ? " trace-toolbar__chip--active" : ""}`}
                    onClick={() => handleToggleType(type)}
                    style={{ borderColor: meta.color, color: isActive ? "#fff" : meta.color, backgroundColor: isActive ? meta.color : "transparent" }}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="trace-toolbar__depth">
            <label className="trace-toolbar__label" htmlFor="trace-depth-limit">
              Depth limit
            </label>
            <div className="trace-toolbar__depth-controls">
              <input
                id="trace-depth-limit"
                type="range"
                min="1"
                max={Math.max(maxDepthInTrace, 1)}
                disabled={!depthLimitEnabled}
                value={Math.min(depthLimit, Math.max(maxDepthInTrace, 1))}
                onChange={(event) => setDepthLimit(Number(event.target.value))}
              />
              <button
                type="button"
                className={`trace-toolbar__toggle${depthLimitEnabled ? " trace-toolbar__toggle--active" : ""}`}
                onClick={() => setDepthLimitEnabled((value) => !value)}
              >
                {depthLimitEnabled ? `≤ ${depthLimit}` : "All"}
              </button>
            </div>
          </div>
          <div className="trace-toolbar__timeline">
            <label className="trace-toolbar__label" htmlFor="trace-timeline-toggle">
              Timeline
            </label>
            <input
              id="trace-timeline-toggle"
              type="checkbox"
              checked={showTimeline}
              onChange={(event) => setShowTimeline(event.target.checked)}
            />
          </div>
        </div>
        <div className="trace-toolbar__actions">
          <button type="button" className="trace-toolbar__reset" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </div>
      <div className="trace-summary">
        <div className="trace-summary__item">
          <span className="trace-summary__label">Events</span>
          <span className="trace-summary__value">{visibleEvents}</span>
          {hiddenEvents > 0 ? (
            <span className="trace-summary__meta">+{hiddenEvents} hidden</span>
          ) : null}
        </div>
        <div className="trace-summary__item">
          <span className="trace-summary__label">Functions</span>
          <span className="trace-summary__value">{visibleFunctions.size}</span>
          <span className="trace-summary__meta">/{uniqueFunctions.size}</span>
        </div>
        <div className="trace-summary__item">
          <span className="trace-summary__label">Depth</span>
          <span className="trace-summary__value">{Math.max(maxDepthInTrace, 1)}</span>
          {depthLimitEnabled ? <span className="trace-summary__meta">showing ≤ {depthLimit}</span> : null}
        </div>
        <div className="trace-summary__item">
          <span className="trace-summary__label">Window</span>
          <span className="trace-summary__value">
            {Number.isFinite(minTime) && Number.isFinite(maxTime)
              ? formatDuration(maxTime - minTime)
              : "—"}
          </span>
        </div>
      </div>
      <div className="trace-content">
        {filteredTree.length === 0 ? (
          <div className="trace-empty">
            <p className="trace-empty__title">No trace data matches the current filters.</p>
            <p className="trace-empty__hint">Try clearing the search, enabling more event types, or showing all depths.</p>
          </div>
        ) : (
          <>
            <div className="trace-tree">
              {filteredTree.map((node, index) =>
                renderNode(node, ensureDepth(node.item.depth, 0), [index]),
              )}
            </div>
            <aside className="trace-panel">
              {selectedItem ? (
                <>
                  <div className="trace-panel__header">
                    <div className="trace-panel__titles">
                      <h2 className="trace-panel__title">{selectedItem.fn || "anonymous"}</h2>
                      {selectedFileLabel ? (
                        <div className="trace-panel__subtitle" title={selectedFileLabel}>
                          {selectedFileLabel}
                        </div>
                      ) : null}
                    </div>
                    {selectedTypeMeta ? (
                      <span
                        className="trace-panel__type"
                        style={{
                          borderColor: selectedTypeMeta.color,
                          color: selectedTypeMeta.color,
                        }}
                      >
                        {selectedTypeMeta.label}
                      </span>
                    ) : null}
                  </div>
                  <div className="trace-panel__meta">
                    <div className="trace-panel__meta-item">
                      <span className="trace-panel__meta-key">Since start</span>
                      <span className="trace-panel__meta-value">
                        {Number.isFinite(selectedRelativeTime)
                          ? formatDuration(selectedRelativeTime)
                          : "—"}
                      </span>
                    </div>
                    <div className="trace-panel__meta-item">
                      <span className="trace-panel__meta-key">Timestamp</span>
                      <span className="trace-panel__meta-value">
                        {Number.isFinite(selectedTimestamp)
                          ? formatTimestamp(selectedTimestamp)
                          : "—"}
                      </span>
                    </div>
                    <div className="trace-panel__meta-item">
                      <span className="trace-panel__meta-key">Depth</span>
                      <span className="trace-panel__meta-value">{selectedDepth}</span>
                    </div>
                    <div className="trace-panel__meta-item">
                      <span className="trace-panel__meta-key">Event</span>
                      <span className="trace-panel__meta-value">
                        #{(selectedItem.index || 0) + 1} of {totalEvents}
                      </span>
                    </div>
                    <div className="trace-panel__meta-item">
                      <span className="trace-panel__meta-key">Next delta</span>
                      <span className="trace-panel__meta-value">
                        {Number.isFinite(Number(selectedDuration))
                          ? formatDuration(Number(selectedDuration))
                          : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="trace-panel__code">
                    <div className="trace-code__toolbar">
                      <span className="trace-code__language">
                        {(codeLanguage || "text").toUpperCase()}
                      </span>
                      {highlightLineNumber ? (
                        <span className="trace-code__line-indicator">
                          Line {highlightLineNumber}
                        </span>
                      ) : null}
                    </div>
                    {activeSource ? (
                      <div className="trace-code__body">
                        <pre className="trace-code__pre">
                          {codeLines.map((line, lineIndex) => {
                            const lineNumber = codeStartLine + lineIndex;
                            const isHighlight = hasHighlightLine && lineNumber === highlightLineNumber;
                            return (
                              <div
                                key={lineNumber}
                                className={`trace-code__line${
                                  isHighlight ? " trace-code__line--highlight" : ""
                                }`}
                                ref={isHighlight ? assignHighlightedLine : null}
                              >
                                <span className="trace-code__line-number">{lineNumber}</span>
                                <span className="trace-code__line-content">
                                  {line || "\u00a0"}
                                </span>
                              </div>
                            );
                          })}
                        </pre>
                      </div>
                    ) : isLoadingSource ? (
                      <div className="trace-panel__message">Loading source…</div>
                    ) : sourceError ? (
                      <div className="trace-panel__message">
                        <p>Unable to load source: {sourceError}</p>
                        {typeof loadSource === "function" ? (
                          <button
                            type="button"
                            className="trace-panel__retry"
                            onClick={handleReloadSource}
                          >
                            Try again
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="trace-panel__message">
                        <p>Provide trace <code>source</code> data or a <code>loadSource</code> prop to preview code.</p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="trace-panel__placeholder">
                  Select a trace event to inspect its details and source code.
                </div>
              )}
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

export default FunctionTracerViewer;
