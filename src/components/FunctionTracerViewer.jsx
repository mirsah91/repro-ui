import React, {useMemo, useState, useCallback} from "react";

/**
 * FunctionTraceViewer — JSX version (no TypeScript).
 *
 * Props:
 *  - trace: Array of { t:number, type:"enter"|"exit", fn:string, file?:string|null, line?:number|null, depth:number }
 *  - now?: number (server epoch ms) — highlights the frame active around this time
 *  - onSeek?: (t:number) => void — called when user clicks a frame; t is the function's start time (server ms)
 *  - options?: {
 *      hideInternal?: boolean      // drop tracer wrappers like fn=="enter"/"exit" (default true)
 *      minDurationMs?: number      // hide frames shorter than this duration (after pairing) (default 0)
 *      collapseVendors?: boolean   // hide frames coming from node_modules (default false)
 *    }
 */

function isInternalWrapper(fn) {
    return fn === "enter" || fn === "exit";
}

function shortPath(p) {
    if (!p) return "";
    const parts = p.split("/");
    const last = parts.slice(-2).join("/");
    return last || p;
}

function buildFrameTree(trace, opts) {
    const hideInternal = opts?.hideInternal !== false; // default true
    const stack = [];
    const roots = [];

    let minT = Number.POSITIVE_INFINITY;
    let maxT = 0;

    for (const e of trace || []) {
        minT = Math.min(minT, e.t);
        maxT = Math.max(maxT, e.t);

        if (hideInternal && isInternalWrapper(e.fn)) continue;

        if (e.type === "enter") {
            const node = {
                id: `${e.fn}@${e.file || ""}:${e.line ?? "?"}:${e.t}:${e.depth}`,
                fn: e.fn,
                file: e.file,
                line: e.line ?? undefined,
                depth: e.depth,
                start: e.t,
                children: [],
            };
            const parent = stack[stack.length - 1];
            if (parent) parent.children.push(node); else roots.push(node);
            stack.push(node);
        } else {
            // exit — pop the most recent matching frame at <= same depth
            for (let i = stack.length - 1; i >= 0; i--) {
                const cand = stack[i];
                if (cand.fn === e.fn && cand.depth === e.depth && cand.end == null) {
                    cand.end = e.t;
                    stack.splice(i, 1);
                    break;
                }
            }
        }
    }

    // Any unclosed frames get end=maxT to still render them
    const fix = (n) => {
        if (n.end == null) n.end = maxT;
        n.children.forEach(fix);
    };
    roots.forEach(fix);

    // Apply minDuration filter if requested
    const minDur = Math.max(0, opts?.minDurationMs ?? 0);
    if (minDur > 0) {
        const filterDur = (nodes) => {
            const out = [];
            for (const n of nodes) {
                const dur = (n.end - n.start);
                const kids = filterDur(n.children);
                const keep = dur >= minDur || kids.length > 0; // keep if long or has long children
                if (keep) out.push({ ...n, children: kids });
            }
            return out;
        };
        const filtered = filterDur(roots);
        return { roots: filtered, minT, maxT };
    }

    return { roots, minT, maxT };
}

function flatten(nodes, out = []) {
    for (const n of nodes) {
        out.push(n);
        flatten(n.children, out);
    }
    return out;
}

function pct(x) { return `${(x * 100).toFixed(3)}%`; }

function classNames(...xs) {
    return xs.filter(Boolean).join(" ");
}

export function FunctionTraceViewer({ trace, now, onSeek, options }) {
    const [localOpts, setLocalOpts] = useState({
        hideInternal: options?.hideInternal !== false,
        minDurationMs: options?.minDurationMs ?? 0,
        collapseVendors: options?.collapseVendors ?? false,
    });

    const { roots, minT, maxT } = useMemo(
        () => buildFrameTree(trace || [], localOpts),
        [trace, localOpts.hideInternal, localOpts.minDurationMs]
    );

    const all = useMemo(() => flatten(roots), [roots]);
    const total = Math.max(1, maxT - minT);

    // Vendor collapsing: mark frames whose file path includes node_modules
    const isVendor = useCallback((n) => (n.file || "").includes("node_modules"), []);

    const visibleRoots = useMemo(() => {
        if (!localOpts.collapseVendors) return roots;
        const pruneVendors = (nodes) => {
            const out = [];
            for (const n of nodes) {
                const kids = pruneVendors(n.children);
                if (isVendor(n) && kids.length === 0) continue; // drop leaf vendor
                out.push({ ...n, children: kids });
            }
            return out;
        };
        return pruneVendors(roots);
    }, [roots, localOpts.collapseVendors, isVendor]);

    const activeId = useMemo(() => {
        if (now == null) return null;
        let best = null;
        for (const n of all) {
            if (n.start <= now && now <= (n.end ?? now)) {
                if (!best || (n.depth > best.depth)) best = n; // deepest
            }
        }
        return best?.id ?? null;
    }, [now, all]);

    const handleSeek = (n) => {
        if (onSeek) onSeek(n.start);
    };

    const Row = ({ n }) => {
        const dur = (n.end - n.start);
        const left = (n.start - minT) / total;
        const width = Math.max(0.001, dur / total);
        const isActive = n.id === activeId;

        return (
            <div
                className={classNames(
                    "group rounded border p-2 mb-1 bg-white",
                    isActive && "ring-2 ring-blue-400"
                )}
            >
                <div className="flex items-center justify-between text-xs text-gray-600">
                    <div className="font-mono truncate" title={`${n.fn} — ${n.file || ""}:${n.line ?? ""}`}>
                        {n.fn}
                        <span className="ml-2 text-gray-400">{shortPath(n.file)}{n.line ? `:${n.line}` : ""}</span>
                    </div>
                    <div className="tabular-nums">
                        {dur}ms
                    </div>
                </div>

                {/* timeline bar */}
                <div
                    className="relative mt-1 h-5 rounded bg-gray-100 overflow-hidden cursor-pointer"
                    title={`${n.fn} (${dur}ms)`}
                    onClick={() => handleSeek(n)}
                >
                    <div
                        className="absolute top-0 bottom-0 bg-gray-400 group-hover:bg-gray-500"
                        style={{ left: pct(left), width: pct(width) }}
                    />
                    <div className="absolute inset-0 pointer-events-none">
                        <div className="h-full border-l border-gray-300" style={{ marginLeft: pct(left) }} />
                    </div>
                </div>

                {n.children.length > 0 && (
                    <div className="mt-2 ml-4">
                        {n.children.map((c) => (
                            <Row key={c.id} n={c} />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="w-full">
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={!!localOpts.hideInternal}
                        onChange={(e) => setLocalOpts((s) => ({ ...s, hideInternal: e.target.checked }))}
                    />
                    hide internal wrappers
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={!!localOpts.collapseVendors}
                        onChange={(e) => setLocalOpts((s) => ({ ...s, collapseVendors: e.target.checked }))}
                    />
                    collapse vendor frames
                </label>
                <label className="flex items-center gap-2">
                    min duration
                    <input
                        type="number"
                        min={0}
                        step={1}
                        value={localOpts.minDurationMs ?? 0}
                        onChange={(e) => setLocalOpts((s) => ({ ...s, minDurationMs: Number(e.target.value) }))}
                        className="w-16 border rounded px-1 py-0.5"
                    />
                    ms
                </label>
                <div className="ml-auto text-gray-500">frames: {all.length}</div>
            </div>

            {/* Tree */}
            <div>
                {visibleRoots.length === 0 && (
                    <div className="text-xs text-gray-500">no frames to display.</div>
                )}
                {visibleRoots.map((n) => (
                    <Row key={n.id} n={n} />
                ))}
            </div>
        </div>
    );
}


