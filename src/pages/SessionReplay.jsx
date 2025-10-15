import React, { useEffect, useMemo, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/rrweb.min.css";
import useTimeline from "../hooks/useTimeline";
import { decodeBase64JsonArray } from "../lib/rrwebDecode";
import EmailItem from "../components/EmailItem.jsx";
import PlayerTimeline from "../components/PlayerTimeline.jsx";

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
    const lastPausedTimeRef = useRef(0);

    const { status, queueRef, pullMore, doneRef } = useRrwebStream(sessionId);
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
    const rrwebZeroTs = rrwebZeroTsRef.current;

    const ticks = useMemo(() => {
        const zero = rrwebZeroTs; // may be null until replay bootstraps
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
    }, [rawTicks, rrwebZeroTs]);

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
                    try {
                        replayerRef.current.pause();
                    } catch (err) {
                        console.warn("failed to pause previous replayer", err);
                    }
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
                    } catch (err) {
                        console.warn("failed to read current replay time", err);
                    }
                }, POLL_MS);

                // background feed: add events one-by-one (safer)
                (async function feed() {
                    while (!cancelled && replayerRef.current && !doneRef.current) {
                        if (queueRef.current.length < 50) {
                            await pullMore(10);
                        }
                        const batch = queueRef.current.splice(0, 50);
                        for (const ev of batch) {
                            try {
                                replayerRef.current.addEvent(ev);
                            } catch (err) {
                                console.warn("failed to append rrweb event", err);
                            }
                        }
                        await new Promise(r => setTimeout(r, 100));
                    }
                })();

                setPlayerStatus("playing");
                return () => window.clearInterval(interval);
            } catch (e) {
                console.error("replay bootstrap error", e);
                setPlayerStatus("error");
            }
        })();

        return () => {
            cancelled = true;
            try {
                replayerRef.current?.pause();
            } catch (err) {
                console.warn("failed to dispose replayer", err);
            }
            replayerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, pullMore, queueRef, doneRef]); // do NOT include `ticks` here to avoid re-initializing the rrweb player on every backend update.

    // if ticks arrive after rrweb started, (re)compute offset without reinitializing player
    useEffect(() => {
        if (!rrwebFirstTsRef.current || !ticks.length) return;
        clockOffsetRef.current = ticks[0]._t - rrwebFirstTsRef.current;
    }, [ticks]);

    function getTotalDuration() {
        const rep = replayerRef.current;
        if (!rep || typeof rep.getMetaData !== "function") return 0;
        try {
            const meta = rep.getMetaData();
            return typeof meta?.totalTime === "number" ? meta.totalTime : 0;
        } catch {
            return 0;
        }
    }

    const canPause = playerStatus === "playing" || playerStatus === "ready";
    const canPlay = playerStatus !== "playing" && playerStatus !== "ready";

    function alignedSeekMsFor(ev) {
        // prefer start → end → point
        const serverMs =
            (typeof ev._startServer === "number" && ev._startServer) ??
            (typeof ev._endServer === "number" && ev._endServer) ??
            (typeof ev._t === "number" && ev._t) ??
            null;

        const rrMs = serverToRrwebOffsetMs(serverMs);
        if (rrMs == null) return null;

        const total = getTotalDuration();
        return Math.max(0, Math.min(total || 0, rrMs));
    }

    function jumpToEvent(ev) {
        const rep = replayerRef.current;
        if (!rep) return;

        const target = alignedSeekMsFor(ev);
        if (target == null) return;

        try {
            rep.pause();
            lastPausedTimeRef.current = target;
            rep.play(target); // seek + play (or play+pause if you want to land paused)
            setPlayerStatus("playing");
            setCurrentTime(target);
        } catch (e) {
            console.warn("seek failed", e);
        }
    }

    function serverToRrwebOffsetMs(serverMs) {
        if (typeof serverMs !== "number") return null;
        const rrFirst = rrwebFirstTsRef.current;
        const offset  = clockOffsetRef.current ?? 0; // server - rrweb
        if (typeof rrFirst !== "number") return null;
        // Convert server epoch → rrweb virtual ms since start
        const virtual = (serverMs - offset) - rrFirst;
        return Number.isFinite(virtual) ? Math.max(0, virtual) : null;
    }

    const totalDuration = getTotalDuration();

    const timelineMarkers = ticks
        .map((event) => {
            const aligned = alignedSeekMsFor(event);
            if (aligned == null) return null;
            return {
                id: event.id ?? event.actionId ?? `${event.kind}-${event._t}`,
                kind: event.kind,
                position: aligned,
                label: event.label || event.meta?.label || event.meta?.url || event.actionId,
                meta: event.meta,
                raw: event,
            };
        })
        .filter(Boolean);

    return (
        <div className="h-screen w-full bg-slate-100/70">
            <div className="grid h-full grid-cols-[minmax(0,2.15fr)_minmax(320px,1fr)] backdrop-blur-sm">
                {/* left: rrweb player */}
                <div className="flex flex-col overflow-hidden border-r border-slate-200 bg-white/90">
                    <div className="relative flex-1 overflow-hidden bg-slate-900/90">
                        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_60%)]" />
                        <div ref={containerRef} className="absolute inset-0" />
                        <div className="pointer-events-none absolute inset-0 border-b border-white/10 shadow-inner" />
                    </div>
                    <div className="border-t border-slate-200 bg-white/70 p-6">
                        <div className="flex items-center gap-3">
                            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {playerStatus}
                            </div>
                            <div className="ml-auto flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        const rep = replayerRef.current;
                                        if (!rep) return;

                                        if (canPlay) {
                                            const resumeAt =
                                                Number.isFinite(lastPausedTimeRef.current) && lastPausedTimeRef.current >= 0
                                                    ? lastPausedTimeRef.current
                                                    : (rep.getCurrentTime?.() ?? currentTime ?? 0);

                                            rep.play(resumeAt);
                                            setPlayerStatus("playing");
                                        } else {
                                            const now = rep.getCurrentTime?.() ?? currentTime ?? 0;
                                            lastPausedTimeRef.current = now;
                                            rep.pause();
                                            setPlayerStatus("paused");
                                        }
                                    }}
                                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                                >
                                    {canPause ? "Pause" : "Play"}
                                </button>
                                <button
                                    onClick={() => {
                                        const rep = replayerRef.current;
                                        if (!rep) return;
                                        rep.pause();
                                        lastPausedTimeRef.current = 0;
                                        rep.play(0);
                                        setPlayerStatus("playing");
                                    }}
                                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                                >
                                    Restart
                                </button>
                            </div>
                        </div>
                        <div className="mt-6">
                            <PlayerTimeline
                                currentTime={currentTime}
                                totalTime={totalDuration}
                                markers={timelineMarkers}
                                onSeek={(next) => {
                                    const rep = replayerRef.current;
                                    if (!rep) return;

                                    rep.pause();
                                    lastPausedTimeRef.current = next;
                                    rep.play(next);
                                    setPlayerStatus("playing");
                                    setCurrentTime(next);
                                }}
                                onMarkerSelect={(marker) => {
                                    if (marker?.raw) {
                                        jumpToEvent(marker.raw);
                                    }
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* right: backend timeline */}
                <div className="flex h-full flex-col overflow-hidden bg-slate-50/80">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-white/60 px-6 py-4 backdrop-blur">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Backend events</div>
                            <div className="text-base font-semibold text-slate-900">
                                {showAll ? "All events" : `Focused around ${Math.round(currentTime)}ms`}
                            </div>
                        </div>
                        <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm">
                            <input
                                type="checkbox"
                                checked={showAll}
                                onChange={(e) => setShowAll(e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                            />
                            show all
                        </label>
                    </div>
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                        {playerStatus === "no-rrweb" && (
                            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 shadow-sm">
                                no rrweb events (or too few to initialize) for this session.
                            </div>
                        )}

                        {!ticks.length && (
                            <div className="text-xs text-slate-500">no backend timeline data for this session.</div>
                        )}

                        <ul className="space-y-4">
                            {renderGroups.map((g, gi) => (
                                <li key={g.id || gi} className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm transition hover:border-slate-300">
                                    {(() => {
                                        const action = g.items.find(it => it.kind === "action");
                                        const title = action?.label || action?.actionId || "Other events";
                                        const win = action ? `[${action.tStart ?? "—"} … ${action.tEnd ?? "—"}]` : "";
                                        return (
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div className="text-sm font-semibold text-slate-900">{title}</div>
                                                {win && <div className="text-[11px] font-mono text-slate-400">{win}</div>}
                                            </div>
                                        );
                                    })()}

                                    <div className="space-y-3">
                                        {g.items.map((e, i) => {
                                            const aligned = toRrwebTime(e._t);
                                            return (
                                                <div
                                                    key={i}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => jumpToEvent(e)}
                                                    onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && jumpToEvent(e)}
                                                    className="group rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                                                >
                                                    <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-400">
                                                        <span>{e.kind}</span>
                                                        <span className="font-mono text-slate-500">{typeof aligned === "number" ? `${Math.round(aligned)}ms` : "—"}</span>
                                                    </div>

                                                    {e.kind === "request" && (
                                                        <div className="space-y-1 text-sm">
                                                            <div className="font-mono text-xs text-slate-900 break-words">
                                                                {e.meta?.method} {e.meta?.url}
                                                            </div>
                                                            <div className="text-xs text-slate-500">
                                                                status {e.meta?.status} • {e.meta?.durMs}ms
                                                            </div>
                                                        </div>
                                                    )}
                                                    {e.kind === "db" && (
                                                        <div className="space-y-1 text-sm">
                                                            <div className="font-mono text-xs text-slate-900">{e.meta?.collection} • {e.meta?.op}</div>
                                                            {e.meta?.query && (
                                                                <pre className="max-h-32 overflow-auto rounded-lg bg-slate-900/90 p-2 text-[11px] text-slate-100 shadow-inner">
                                                                    {JSON.stringify(e.meta.query, null, 2)}
                                                                </pre>
                                                            )}
                                                            {e.meta?.resultMeta && (
                                                                <div className="text-xs text-slate-500">
                                                                    result {JSON.stringify(e.meta.resultMeta)}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {e.kind === "action" && (
                                                        <div className="space-y-1 text-sm">
                                                            <div className="font-mono text-xs text-slate-900 break-words">{e.label || e.actionId}</div>
                                                            {(typeof e.tStart === "number" || typeof e.tEnd === "number") && (
                                                                <div className="text-xs text-slate-500">[{e.tStart ?? "—"} … {e.tEnd ?? "—"}]</div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {e.kind === "email" && <EmailItem meta={e.meta} />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </li>
                            ))}
                            {!renderGroups.length && !showAll && (
                                <li className="text-xs text-slate-500">
                                    no events near the current time. Try{" "}
                                    <button className="font-semibold text-slate-700 underline" onClick={() => setShowAll(true)}>show all</button>.
                                </li>
                            )}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
