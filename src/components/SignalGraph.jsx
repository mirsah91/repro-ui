import React, { useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    ReactFlowProvider,
    useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";

const LANE_LABELS = {
    action: "User actions",
    request: "Network",
    db: "Database",
    email: "Email",
    other: "Other",
};

const DEFAULT_COLORS = {
    action: "#38bdf8",
    request: "#34d399",
    db: "#fbbf24",
    email: "#f472b6",
    other: "#cbd5f5",
};

function SignalNode({ data }) {
    return (
        <div className="pointer-events-auto w-64 max-w-[280px] rounded-2xl border border-white/10 bg-slate-950/90 p-4 shadow-[0_22px_48px_-28px_rgba(15,23,42,1)] backdrop-blur transition hover:border-white/30 hover:bg-slate-900/80">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.34em] text-white/50">
                <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: data.color || DEFAULT_COLORS.other }}
                    aria-hidden
                />
                {LANE_LABELS[data.kind] || data.kind}
            </div>

            <div className="mt-2 text-sm font-semibold text-white">{data.name || data.title}</div>

            {data.detail && (
                <div className="mt-1 text-xs text-white/60">
                    {data.detail}
                </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-mono text-white/60">
                {data.relative && <span className="text-sky-200">{data.relative}</span>}
                {data.durationLabel && <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/60">{data.durationLabel}</span>}
            </div>
        </div>
    );
}

const nodeTypes = { signal: SignalNode };

function GraphCanvas({ nodes, edges, onNodeClick }) {
    const instance = useReactFlow();

    useEffect(() => {
        if (!nodes.length) return;
        const timeout = window.setTimeout(() => {
            try {
                instance.fitView({ padding: 0.18, duration: 600 });
            } catch {}
        }, 120);

        return () => window.clearTimeout(timeout);
    }, [instance, nodes]);

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            fitView
            proOptions={{ hideAttribution: true }}
            className="!bg-transparent text-slate-100"
            panOnScroll
            zoomOnScroll
            onNodeClick={(event, node) => {
                event.preventDefault();
                if (onNodeClick) onNodeClick(node);
            }}
        >
            <Background color="rgba(148,163,184,0.14)" />
            <MiniMap
                nodeColor={(n) => n.data?.color || DEFAULT_COLORS.other}
                maskColor="rgba(15,23,42,0.55)"
                style={{ background: "rgba(15,23,42,0.45)" }}
            />
            <Controls showInteractive={false} className="!bg-slate-900/80 !text-slate-200" />
        </ReactFlow>
    );
}

function buildGraph(events) {
    if (!events?.length) {
        return { nodes: [], edges: [], lanes: [] };
    }

    const sorted = [...events].sort((a, b) => {
        const ta = typeof a.serverStart === "number" ? a.serverStart : a.serverTime ?? 0;
        const tb = typeof b.serverStart === "number" ? b.serverStart : b.serverTime ?? 0;
        if (ta !== tb) return ta - tb;
        const da = (typeof a.serverEnd === "number" ? a.serverEnd : a.serverTime ?? 0) - ta;
        const db = (typeof b.serverEnd === "number" ? b.serverEnd : b.serverTime ?? 0) - tb;
        if (da !== db) return da - db;
        return (a.id || "").localeCompare(b.id || "");
    });

    let minTime = Infinity;
    let maxTime = -Infinity;
    const laneIndexMap = new Map();
    const nodes = [];

    sorted.forEach((item, index) => {
        const primaryTime = typeof item.serverTime === "number"
            ? item.serverTime
            : typeof item.serverStart === "number"
                ? item.serverStart
                : typeof item.serverEnd === "number"
                    ? item.serverEnd
                    : index;

        const endTime = typeof item.serverEnd === "number" ? item.serverEnd : primaryTime;
        minTime = Math.min(minTime, primaryTime);
        maxTime = Math.max(maxTime, endTime);

        const kindKey = LANE_LABELS[item.kind] ? item.kind : "other";
        if (!laneIndexMap.has(kindKey)) {
            laneIndexMap.set(kindKey, laneIndexMap.size);
        }
        const laneIndex = laneIndexMap.get(kindKey);

        nodes.push({
            id: item.id || `event-${index}`,
            type: "signal",
            position: { x: 0, y: 0 },
            data: { ...item, kind: kindKey },
            draggable: false,
        });
    });

    if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
        minTime = 0;
        maxTime = nodes.length || 1;
    }

    if (maxTime <= minTime) {
        maxTime = minTime + Math.max(nodes.length * 10, 1);
    }

    const span = maxTime - minTime;
    const laneHeight = 160;
    const baseX = 160;
    const baseY = 60;
    const travelWidth = Math.max(nodes.length * 220, 1200);

    nodes.forEach((node, index) => {
        const item = node.data;
        const primaryTime = typeof item.serverTime === "number"
            ? item.serverTime
            : typeof item.serverStart === "number"
                ? item.serverStart
                : typeof item.serverEnd === "number"
                    ? item.serverEnd
                    : minTime + index * (span / Math.max(nodes.length, 1));

        const normalized = span > 0 ? (primaryTime - minTime) / span : index / Math.max(nodes.length - 1, 1);
        const laneIndex = laneIndexMap.get(item.kind) ?? 0;
        node.position = {
            x: baseX + normalized * travelWidth,
            y: baseY + laneIndex * laneHeight,
        };
    });

    const edges = [];
    for (let i = 1; i < nodes.length; i += 1) {
        const prev = nodes[i - 1];
        const curr = nodes[i];
        edges.push({
            id: `edge-${prev.id}-${curr.id}`,
            source: prev.id,
            target: curr.id,
            type: "smoothstep",
            animated: true,
            style: { stroke: "rgba(56,189,248,0.75)", strokeWidth: 1.6 },
        });
    }

    const lanes = Array.from(laneIndexMap.entries())
        .map(([kind, idx]) => ({
            kind,
            index: idx,
            label: LANE_LABELS[kind] || kind,
            color: DEFAULT_COLORS[kind] || DEFAULT_COLORS.other,
        }))
        .sort((a, b) => a.index - b.index);

    return { nodes, edges, lanes };
}

export default function SignalGraph({ events, onClose, onNodeSelect }) {
    const graph = useMemo(() => buildGraph(events), [events]);

    const handleNodeClick = useCallback((node) => {
        if (onNodeSelect) {
            onNodeSelect(node.data?.event);
        }
    }, [onNodeSelect]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 px-6 py-10 backdrop-blur">
            <div className="relative flex w-full max-w-6xl flex-col gap-6 rounded-3xl border border-white/10 bg-slate-950/95 p-8 shadow-[0_72px_160px_-80px_rgba(15,23,42,1)]">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="text-xs uppercase tracking-[0.32em] text-white/50">Signals graph</div>
                        <h3 className="mt-1 text-2xl font-semibold text-white">Explore backend activity</h3>
                        <p className="mt-2 max-w-2xl text-sm text-white/60">
                            Each node tracks a backend event captured during the session replay. Hover to inspect, drag the canvas to explore, or click a node to jump the replay to that moment.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10"
                    >
                        Close
                    </button>
                </header>

                <div className="grid gap-6 lg:grid-cols-[180px,1fr]">
                    <aside className="space-y-3">
                        {graph.lanes.map((lane) => (
                            <div key={lane.kind} className="flex items-center gap-3 text-xs text-white/70">
                                <span
                                    className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full"
                                    style={{ backgroundColor: lane.color }}
                                    aria-hidden
                                />
                                <span>{lane.label}</span>
                            </div>
                        ))}
                        {!graph.lanes.length && (
                            <div className="text-xs text-white/50">No events captured for this session.</div>
                        )}
                    </aside>

                    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/75">
                        <ReactFlowProvider>
                            <div className="h-[520px] w-full">
                                <GraphCanvas nodes={graph.nodes} edges={graph.edges} onNodeClick={handleNodeClick} />
                            </div>
                        </ReactFlowProvider>
                    </div>
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-4 text-xs text-white/60">
                    <span>Scroll or pinch to zoom · Drag to pan</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 font-semibold text-white/80 transition hover:border-white/30 hover:bg-white/10"
                    >
                        Back to timeline
                    </button>
                </footer>
            </div>
        </div>
    );
}
