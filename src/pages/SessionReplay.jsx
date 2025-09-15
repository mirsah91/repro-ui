import React, { useEffect, useMemo, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/rrweb.min.css";
import useTimeline from "../hooks/useTimeline";
import { decodeBase64JsonArray } from "../lib/rrwebDecode";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const WINDOW_MS = 1500;
const POLL_MS = 200;

// rank order inside one action group
const KIND_RANK = { action: 0, request: 1, db: 2, email: 3 };

// pick a point time (server epoch ms) from any item
function itemServerTime(it) {
    if (typeof it.t === "number") return it.t;
    if (typeof it.tStart === "number") return it.tStart;
    if (typeof it.tEnd === "number") return it.tEnd;
    return null;
}

// group items by actionId; singletons for items without actionId
function groupByAction(items) {
    const groups = new Map();
    for (const it of items) {
        const key =
            it.actionId ||
            `__nogroup__:${it.kind}:${Math.random().toString(36).slice(2)}`;
        let g = groups.get(key);
        if (!g) {
            g = { id: key, items: [], start: Infinity, end: -Infinity };
            groups.set(key, g);
        }
        const t = itemServerTime(it);
        if (typeof t === "number") {
            g.start = Math.min(g.start, t);
            g.end = Math.max(g.end, t);
        }
        g.items.push(it);
    }

    // sort items inside group by time, then by kind rank
    for (const g of groups.values()) {
        g.items.sort((a, b) => {
            const ra = KIND_RANK[a.kind] ?? 99;
            const rb = KIND_RANK[b.kind] ?? 99;
            if (ra !== rb) return ra - rb;

            const ta = itemServerTime(a) ?? Infinity;
            const tb = itemServerTime(b) ?? Infinity;
            return ta - tb;
        });
    }

    // sort groups by their first timestamp
    return Array.from(groups.values()).sort((a, b) => a.start - b.start);
}

// flatten grouped list back to a single array for rendering
function flattenGrouped(groups) {
    const out = [];
    for (const g of groups) out.push(...g.items);
    return out;
}


function useRrwebStream(sessionId) {
    const [meta, setMeta] = useState({ firstSeq: 0, lastSeq: 0 });
    const [status, setStatus] = useState("idle"); // idle | loading | ready | error

    const queueRef = useRef([]);
    const nextSeqRef = useRef(0);
    const doneRef = useRef(false);

    useEffect(() => {
        let mounted = true;
        (async () => {
            setStatus("loading");
            try {
                const r = await fetch(`${API_BASE}/v1/sessions/${sessionId}/full?includeRrweb=1`);
                const j = await r.json();
                const m = j?.rrweb || { firstSeq: 0, lastSeq: 0 };
                if (!mounted) return;
                setMeta(m);
                nextSeqRef.current = Math.max(0, Number(m.firstSeq || 0));
                doneRef.current = false;
                queueRef.current = [];
                setStatus("ready");
            } catch {
                setStatus("error");
            }
        })();
        return () => { mounted = false; };
    }, [sessionId]);

    async function pullMore(limit = 5) {
        if (doneRef.current) return;
        const afterSeq = nextSeqRef.current - 1; // endpoint expects > afterSeq
        const r = await fetch(`${API_BASE}/v1/sessions/${sessionId}/rrweb?afterSeq=${afterSeq}&limit=${limit}`);
        const j = await r.json();
        const items = j?.items || [];
        if (!items.length) { doneRef.current = true; return; }

        for (const it of items) {
            const events = decodeBase64JsonArray(it.base64);
            if (events?.length) queueRef.current.push(...events);
            nextSeqRef.current = Math.max(nextSeqRef.current, Number(it.seq) + 1);
        }
    }

    return { meta, status, queueRef, pullMore, doneRef };
}

// utility: pick a usable timestamp from a timeline item
function tickTime(ev) {
    if (typeof ev?.t === "number") return ev.t;
    if (typeof ev?.tStart === "number") return ev.tStart;
    if (typeof ev?.tEnd === "number") return ev.tEnd;
    return null;
}

// Build a [start,end] window in SERVER time for any timeline item
function deriveServerWindow(ev) {
    const base =
        typeof ev?.t === "number"
            ? ev.t
            : typeof ev?.tStart === "number"
                ? ev.tStart
                : typeof ev?.tEnd === "number"
                    ? ev.tEnd
                    : null;

    if (base == null) return { start: null, end: null };

    // If action has explicit window, use it
    if (typeof ev.tStart === "number" || typeof ev.tEnd === "number") {
        return {
            start: typeof ev.tStart === "number" ? ev.tStart : base,
            end: typeof ev.tEnd === "number" ? ev.tEnd : base,
        };
    }

    // If request has duration, treat t as END
    const dur = typeof ev?.meta?.durMs === "number" ? ev.meta.durMs : null;
    if (dur && dur > 0) {
        return { start: base - dur, end: base };
    }

    // Instant
    return { start: base, end: base };
}

// Is absolute time `abs` near [start,end] (both in SERVER ms)?
function absInWindow(abs, start, end, win) {
    if (typeof abs !== "number") return false;
    if (typeof start !== "number" && typeof end !== "number") return false;
    const s = typeof start === "number" ? start : end;
    const e = typeof end === "number" ? end : start;
    return abs >= s - win && abs <= e + win;
}

export default function SessionReplay({ sessionId }) {
    const containerRef = useRef(null);
    const replayerRef = useRef(null);
    const rrwebZeroTsRef = useRef(null); // first rrweb event timestamp (epoch ms)

    const { meta, status, queueRef, pullMore, doneRef } = useRrwebStream(sessionId);
    const rawTicks = useTimeline(sessionId); // backend events (server time)

    const [currentTime, setCurrentTime] = useState(0); // rrweb virtual ms
    const [playerStatus, setPlayerStatus] = useState("idle"); // idle | loading | ready | no-rrweb | error
    const [showAll, setShowAll] = useState(false);

    // time alignment
    const rrwebFirstTsRef = useRef(null);   // first rrweb event.timestamp
    const clockOffsetRef = useRef(0);       // server_ms - rrweb_ms

    const toRrwebTime = (serverMs) =>
        typeof serverMs === "number" ? (serverMs - (clockOffsetRef.current || 0)) : null;

    // normalize and sort ticks once
    const ticks = useMemo(() => {
        const zero = rrwebZeroTsRef.current; // may be null until replay bootstraps
        const out = [];

        for (const ev of rawTicks || []) {
            const { start, end } = deriveServerWindow(ev);
            if (typeof start !== "number" && typeof end !== "number") continue;

            // aligned (rrweb) times are derived only if we already know the rrweb epoch
            const alignedStart = typeof zero === "number" && typeof start === "number" ? (start - zero) : null;
            const alignedEnd   = typeof zero === "number" && typeof end   === "number" ? (end   - zero) : null;

            out.push({
                ...ev,
                _t: tickTime(ev),           // original server “point” for display fallbacks
                _startServer: start,        // server ms
                _endServer: end,            // server ms
                _alignedStart: alignedStart, // rrweb ms (since first rrweb event)
                _alignedEnd: alignedEnd,     // rrweb ms
            });
        }

        // Sort by SERVER start (stable regardless of rrweb init timing)
        out.sort((a, b) => {
            const aa = (typeof a._startServer === "number" ? a._startServer : a._endServer ?? 0);
            const bb = (typeof b._startServer === "number" ? b._startServer : b._endServer ?? 0);
            if (aa !== bb) return aa - bb;
            // tie-break by duration
            const da = (a._endServer ?? aa) - (a._startServer ?? aa);
            const db = (b._endServer ?? bb) - (b._startServer ?? bb);
            return da - db;
        });

        return out;
    }, [rawTicks, rrwebZeroTsRef.current]);

    // absolute rrweb "now" in SERVER epoch ms (or null if player not ready)
    const absNow = useMemo(() => {
        const zero = rrwebZeroTsRef.current;
        return typeof zero === "number" ? zero + currentTime : null;
    }, [currentTime]);

    // choose base items: either everything (showAll) or only items near the current window
    const baseItems = useMemo(() => {
        if (showAll) return ticks;
        if (absNow == null) return [];
        return ticks.filter((ev) =>
            absInWindow(absNow, ev._startServer, ev._endServer, WINDOW_MS)
        );
    }, [ticks, showAll, absNow]);

    // final list to render: grouped by action, then flattened (Action → Request → DB → Email)
    const renderList = useMemo(() => {
        const groups = groupByAction(baseItems);
        return flattenGrouped(groups);
    }, [baseItems]);

    // groups to render (Action → Request → DB → Email)
    const renderGroups = React.useMemo(() => {
        return groupByAction(baseItems);
    }, [baseItems]);

    // bootstrap player once rrweb meta is ready
    useEffect(() => {
        if (status !== "ready" || !containerRef.current || replayerRef.current) return;

        let cancelled = false;
        (async () => {
            try {
                setPlayerStatus("loading");

                // ensure we have at least 2 events for rrweb init
                while (queueRef.current.length < 2 && !doneRef.current) {
                    await pullMore(10);
                }
                const initial = queueRef.current.splice(0, queueRef.current.length);
                if (!initial.length) return;

                rrwebZeroTsRef.current = initial[0]?.timestamp || null;

                if (!initial.length || initial.length < 2) {
                    setPlayerStatus("no-rrweb");
                    return;
                }

                rrwebFirstTsRef.current = initial[0]?.timestamp || null;

                // compute initial offset if ticks already available
                if (rrwebFirstTsRef.current && ticks.length) {
                    clockOffsetRef.current = ticks[0]._t - rrwebFirstTsRef.current;
                } else {
                    clockOffsetRef.current = 0;
                }

                // init replayer
                if (replayerRef.current) {
                    try { replayerRef.current.pause(); } catch {}
                }
                const rep = new Replayer(initial, {
                    root: containerRef.current,
                    liveMode: false,
                    UNSAFE_replayCanvas: true,
                    speed: 1.0,
                    mouseTail: false,
                });
                replayerRef.current = rep;
                rep.play();

                // keep current time in sync
                const interval = window.setInterval(() => {
                    try {
                        const t = replayerRef.current?.getCurrentTime?.() ?? 0;
                        setCurrentTime(t);
                    } catch {}
                }, POLL_MS);

                // background feed: add events one-by-one (safer)
                (async function feed() {
                    while (!cancelled && replayerRef.current && !doneRef.current) {
                        if (queueRef.current.length < 50) {
                            await pullMore(10);
                        }
                        const batch = queueRef.current.splice(0, 50);
                        for (const ev of batch) {
                            try { replayerRef.current.addEvent(ev); } catch {}
                        }
                        await new Promise(r => setTimeout(r, 100));
                    }
                })();

                setPlayerStatus("ready");
                return () => window.clearInterval(interval);
            } catch (e) {
                console.error("replay bootstrap error", e);
                setPlayerStatus("error");
            }
        })();

        return () => {
            cancelled = true;
            try { replayerRef.current?.pause(); } catch {}
            replayerRef.current = null;
        };
    }, [status, /* do NOT include ticks here to avoid re-init loop */]);

    // if ticks arrive after rrweb started, (re)compute offset without reinitializing player
    useEffect(() => {
        if (!rrwebFirstTsRef.current || !ticks.length) return;
        clockOffsetRef.current = ticks[0]._t - rrwebFirstTsRef.current;
    }, [ticks]);

    // filter “nearby” events by aligned time
    const nearby = useMemo(() => {
        if (!ticks.length) return [];
        if (showAll) return ticks;

        // rrweb current “absolute” = first rrweb timestamp + currentTime
        const zero = rrwebZeroTsRef.current;
        if (typeof zero !== "number") return [];

        const absNow = zero + currentTime; // epoch ms
        return ticks
            .filter((ev) => absInWindow(absNow, ev._startServer, ev._endServer, WINDOW_MS))
            .slice(0, 50);
    }, [ticks, currentTime, showAll]);

    const orderedNearby = React.useMemo(() => {
        const actions  = nearby.filter(e => e.kind === "action");
        const requests = nearby.filter(e => e.kind === "request");
        const dbs      = nearby.filter(e => e.kind === "db");
        const emails   = nearby.filter(e => e.kind === "email");
        return [...actions, ...requests, ...dbs, ...emails];
    }, [nearby]);

    return (
        <div className="flex h-screen">
            {/* left: rrweb player */}
            <div className="flex-1 flex flex-col">
                <div ref={containerRef} className="flex-1 bg-gray-50 border-b" />
                <div className="p-2 border-t text-sm text-gray-600">
                    time: {Math.round(currentTime)} ms
                    <span className="ml-4">seq range: {meta.firstSeq ?? "—"} → {meta.lastSeq ?? "—"}</span>
                    <span className="ml-4">status: {playerStatus}</span>
                </div>
            </div>

            {/* right: backend sidebar */}
            <div className="w-[28rem] min-w-[22rem] max-w-[32rem] border-l p-3 overflow-auto">
                <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">
                        backend events {showAll ? "(all)" : `near ${Math.round(currentTime)}ms`}
                    </div>
                    <label className="text-xs flex items-center gap-2">
                        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                        show all
                    </label>
                </div>

                {playerStatus === "no-rrweb" && (
                    <div className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-2 mb-3">
                        no rrweb events (or too few to initialize) for this session.
                    </div>
                )}

                {!ticks.length && (
                    <div className="text-xs text-gray-500 mb-2">
                        no backend timeline data for this session.
                    </div>
                )}

                <ul className="space-y-2">
                    <ul className="space-y-3">
                        {renderGroups.map((g, gi) => (
                            <li key={g.id || gi} className="rounded border p-2">
                                {/* Group header: show the Action label if present, else a generic tag */}
                                {(() => {
                                    const action = g.items.find(it => it.kind === "action");
                                    const title = action?.label || action?.actionId || "Other events";
                                    const win = action
                                        ? `[${action.tStart ?? "—"} … ${action.tEnd ?? "—"}]`
                                        : "";
                                    return (
                                        <div className="mb-2">
                                            <div className="text-xs font-semibold text-gray-700">
                                                {title} {win && <span className="ml-2 text-gray-500">{win}</span>}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Group items in rank order (already sorted by groupByAction) */}
                                <div className="space-y-2">
                                    {g.items.map((e, i) => {
                                        const aligned = toRrwebTime(e._t);
                                        return (
                                            <div key={i} className="rounded border p-2">
                                                <div className="text-xs text-gray-500">
                                                    {e.kind} @ {e._t} (aligned
                                                    ~ {typeof aligned === "number" ? Math.round(aligned) : "—"}ms)
                                                </div>

                                                {e.kind === "request" && (
                                                    <div className="text-sm">
                                                        <div className="font-mono break-all">
                                                            {e.meta?.method} {e.meta?.url}
                                                        </div>
                                                        <div className="text-gray-600">
                                                            status {e.meta?.status} • {e.meta?.durMs}ms
                                                        </div>
                                                    </div>
                                                )}

                                                {e.kind === "db" && (
                                                    <div className="text-sm">
                                                        <div
                                                            className="font-mono">{e.meta?.collection} • {e.meta?.op}</div>
                                                        {e.meta?.query && (
                                                            <pre
                                                                className="text-[11px] bg-black-50 rounded p-1 overflow-auto">
{JSON.stringify(e.meta.query, null, 2)}
                    </pre>
                                                        )}
                                                        {e.meta?.resultMeta && (
                                                            <div className="text-gray-600 text-xs">
                                                                result {JSON.stringify(e.meta.resultMeta)}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {e.kind === "email" && (
                                                    <div className="text-sm">
                                                        <div className="font-mono break-all">{e.meta?.subject}</div>
                                                        <div className="text-gray-600 text-xs">
                                                            to: {(e.meta?.to || []).map(a => a?.email || a).join(", ")} • {e.meta?.statusCode ?? "—"}
                                                        </div>
                                                    </div>
                                                )}

                                                {e.kind === "action" && (
                                                    <div className="text-sm">
                                                        <div className="font-mono break-all">{e.label || e.actionId}</div>
                                                        {(typeof e.tStart === "number" || typeof e.tEnd === "number") && (
                                                            <div className="text-gray-600 text-xs">
                                                                [{e.tStart ?? "—"} … {e.tEnd ?? "—"}]
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </li>
                        ))}

                        {!renderGroups.length && !showAll && (
                            <li className="text-xs text-gray-500">
                                no events near the current time. Try{" "}
                                <button className="underline" onClick={() => setShowAll(true)}>show all</button>.
                            </li>
                        )}
                    </ul>
                </ul>
            </div>
        </div>
    );
}
