import React, { useEffect, useMemo, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/rrweb.min.css";
import useTimeline from "../hooks/useTimeline";
import { decodeBase64JsonArray } from "../lib/rrwebDecode";
import EmailItem from "../components/EmailItem.jsx";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const WINDOW_MS = 1500;
const POLL_MS = 200;

// ===== DEBUG =====
const DEBUG = true;
const log = (...a) => DEBUG && console.log("[repro:replay]", ...a);
const warn = (...a) => DEBUG && console.warn("[repro:replay]", ...a);

// rank order inside one action group
const KIND_RANK = { action: 0, request: 1, db: 2, email: 3 };

function itemServerTime(it) {
    if (typeof it.t === "number") return it.t;
    if (typeof it.tStart === "number") return it.tStart;
    if (typeof it.tEnd === "number") return it.tEnd;
    return null;
}

function groupByAction(items) {
    const groups = new Map();
    for (const it of items) {
        const key = it.actionId || `__nogroup__:${it.kind}:${Math.random().toString(36).slice(2)}`;
        let g = groups.get(key);
        if (!g) { g = { id: key, items: [], start: Infinity, end: -Infinity }; groups.set(key, g); }
        const t = itemServerTime(it);
        if (typeof t === "number") { g.start = Math.min(g.start, t); g.end = Math.max(g.end, t); }
        g.items.push(it);
    }
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
    return Array.from(groups.values()).sort((a, b) => a.start - b.start);
}

function useRrwebStream(sessionId) {
    const [meta, setMeta] = useState({ firstSeq: 0, lastSeq: 0 });
    const [status, setStatus] = useState("idle");
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
                log("rrweb meta loaded", m);
            } catch (e) {
                warn("meta load failed", e);
                setStatus("error");
            }
        })();
        return () => { mounted = false; };
    }, [sessionId]);

    async function pullMore(limit = 5) {
        if (doneRef.current) return;
        const afterSeq = nextSeqRef.current - 1;
        const r = await fetch(`${API_BASE}/v1/sessions/${sessionId}/rrweb?afterSeq=${afterSeq}&limit=${limit}`);
        const j = await r.json();
        const items = j?.items || [];
        if (!items.length) { doneRef.current = true; return; }
        for (const it of items) {
            const events = decodeBase64JsonArray(it.base64);
            if (events?.length) queueRef.current.push(...events);
            nextSeqRef.current = Math.max(nextSeqRef.current, Number(it.seq) + 1);
        }
        log("pulled rrweb chunk", { limit, got: items.length, nextSeq: nextSeqRef.current, queue: queueRef.current.length });
    }

    return { meta, status, queueRef, pullMore, doneRef };
}

function tickTime(ev) {
    if (typeof ev?.t === "number") return ev.t;
    if (typeof ev?.tStart === "number") return ev.tStart;
    if (typeof ev?.tEnd === "number") return ev.tEnd;
    return null;
}

function deriveServerWindow(ev) {
    const base =
        typeof ev?.t === "number" ? ev.t :
            typeof ev?.tStart === "number" ? ev.tStart :
                typeof ev?.tEnd === "number" ? ev.tEnd : null;
    if (base == null) return { start: null, end: null };
    if (typeof ev.tStart === "number" || typeof ev.tEnd === "number") {
        return { start: typeof ev.tStart === "number" ? ev.tStart : base, end: typeof ev.tEnd === "number" ? ev.tEnd : base };
    }
    const dur = typeof ev?.meta?.durMs === "number" ? ev.meta.durMs : null;
    if (dur && dur > 0) return { start: base - dur, end: base };
    return { start: base, end: base };
}

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
    const rrwebZeroTsRef = useRef(null);
    const lastPausedTimeRef = useRef(0);
    const lastPlayerSizeRef = useRef({ width: 0, height: 0 });

    const { status, queueRef, pullMore, doneRef } = useRrwebStream(sessionId);
    const rawTicks = useTimeline(sessionId);

    const [currentTime, setCurrentTime] = useState(0);
    const [playerStatus, setPlayerStatus] = useState("idle");
    const [showAll, setShowAll] = useState(false);
    const [playerMeta, setPlayerMeta] = useState({ totalTime: 0 });
    const [hoveredMarker, setHoveredMarker] = useState(null);
    const [activeEventId, setActiveEventId] = useState(null);

    const rrwebFirstTsRef = useRef(null);
    const clockOffsetRef = useRef(0);

    // ---- sizing helpers (content-box) ----
    const measureContainerSize = React.useCallback(() => {
        const el = containerRef.current;
        if (!el) return null;
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w > 0 && h > 0) {
            const size = { width: Math.round(w), height: Math.round(h) };
            log("measureContainerSize (client):", size);
            return size;
        }
        const rect = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const bw = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
        const bh = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
        const size = { width: Math.max(0, Math.round(rect.width - bw)), height: Math.max(0, Math.round(rect.height - bh)) };
        log("measureContainerSize (fallback):", size);
        return size.width && size.height ? size : null;
    }, []);

    const waitForContainerSize = React.useCallback(async () => {
        let size = measureContainerSize();
        for (let i = 0; i < 20 && (!size || size.width < 2 || size.height < 2); i++) {
            await new Promise((r) => requestAnimationFrame(r));
            size = measureContainerSize();
            log("waitForContainerSize tick", i, size);
        }
        return size;
    }, [measureContainerSize]);

    // ---- robust iframe finding & syncing ----
    const findIframe = React.useCallback(() => {
        const root = containerRef.current;
        if (!root) return null;
        // rrweb may wrap with different classnames across versions; just find any iframe inside.
        const iframe = root.querySelector("iframe");
        return iframe || null;
    }, []);

    const syncIframe = React.useCallback((size, tag = "sync") => {
        const iframe = findIframe();
        if (!iframe) {
            warn(`${tag}: iframe not found (will retry)`);
            // retry a few times over the next frames — iframe often appears 1–2 RAFs after init
            let attempts = 0;
            const tryAgain = () => {
                const ifr = findIframe();
                attempts++;
                if (ifr) {
                    ifr.style.width = `${size.width}px`;
                    ifr.style.height = `${size.height}px`;
                    ifr.setAttribute("width", String(size.width));
                    ifr.setAttribute("height", String(size.height));
                    log(`${tag}: iframe found on retry ${attempts}`, {
                        calc: size,
                        iframeClient: { w: ifr.clientWidth, h: ifr.clientHeight },
                    });
                    return;
                }
                if (attempts < 8) requestAnimationFrame(tryAgain);
                else warn(`${tag}: iframe still missing after retries`);
            };
            requestAnimationFrame(tryAgain);
            return;
        }
        // set both style and attributes
        iframe.style.width = `${size.width}px`;
        iframe.style.height = `${size.height}px`;
        iframe.setAttribute("width", String(size.width));
        iframe.setAttribute("height", String(size.height));
        const dump = {
            calc: size,
            iframeClient: { w: iframe.clientWidth, h: iframe.clientHeight },
            iframeAttrs: { width: iframe.getAttribute("width"), height: iframe.getAttribute("height") },
        };
        log(`${tag}: synced iframe`, dump);
    }, [findIframe]);

    // Observe iframe insertion once, right after init
    const setupIframeObserver = React.useCallback((size) => {
        const root = containerRef.current;
        if (!root) return () => {};
        const mo = new MutationObserver(() => {
            const iframe = findIframe();
            if (iframe) {
                log("MutationObserver: iframe appeared");
                syncIframe(size, "mo-sync");
                // optional: disconnect after first sync
                mo.disconnect();
            }
        });
        mo.observe(root, { childList: true, subtree: true });
        return () => mo.disconnect();
    }, [findIframe, syncIframe]);

    // ---- alignment helpers ----
    const serverToRrwebOffsetMs = React.useCallback((serverMs) => {
        if (typeof serverMs !== "number") return null;
        const rrFirst = rrwebFirstTsRef.current;
        const offset = clockOffsetRef.current ?? 0;
        if (typeof rrFirst !== "number") return null;
        const virtual = serverMs - offset - rrFirst;
        return Number.isFinite(virtual) ? Math.max(0, virtual) : null;
    }, []);

    const toRrwebTime = (serverMs) =>
        typeof serverMs === "number" ? serverMs - (clockOffsetRef.current || 0) : null;

    // ---- normalize ticks ----
    const ticks = useMemo(() => {
        const zero = rrwebZeroTsRef.current;
        const out = [];
        for (const [idx, ev] of (rawTicks || []).entries()) {
            const { start, end } = deriveServerWindow(ev);
            if (typeof start !== "number" && typeof end !== "number") continue;
            const alignedStart = typeof zero === "number" && typeof start === "number" ? start - zero : null;
            const alignedEnd = typeof zero === "number" && typeof end === "number" ? end - zero : null;
            const keyParts = [ev.id, ev.actionId, ev.kind, ev.meta?.id, typeof ev.t === "number" ? ev.t : null, typeof start === "number" ? start : null, typeof end === "number" ? end : null].filter(Boolean);
            out.push({
                ...ev,
                _t: tickTime(ev),
                _startServer: start,
                _endServer: end,
                _alignedStart: alignedStart,
                _alignedEnd: alignedEnd,
                __key: `${keyParts.join("|") || ev.kind || "event"}-${idx}`,
            });
        }
        out.sort((a, b) => {
            const aa = typeof a._startServer === "number" ? a._startServer : a._endServer ?? 0;
            const bb = typeof b._startServer === "number" ? b._startServer : b._endServer ?? 0;
            if (aa !== bb) return aa - bb;
            const da = (a._endServer ?? aa) - (a._startServer ?? aa);
            const db = (b._endServer ?? bb) - (b._startServer ?? bb);
            return da - db;
        });
        return out;
    }, [rawTicks]);

    const absNow = useMemo(() => {
        const zero = rrwebZeroTsRef.current;
        return typeof zero === "number" ? zero + currentTime : null;
    }, [currentTime]);

    const baseItems = useMemo(() => {
        if (showAll) return ticks;
        if (absNow == null) return [];
        return ticks.filter((ev) => absInWindow(absNow, ev._startServer, ev._endServer, WINDOW_MS));
    }, [ticks, showAll, absNow]);

    const renderGroups = useMemo(() => groupByAction(baseItems), [baseItems]);

    // ---- bootstrap rrweb ----
    useEffect(() => {
        if (status !== "ready" || !containerRef.current || replayerRef.current) return;

        let cancelled = false;
        let disconnectMO = null;

        (async () => {
            try {
                setPlayerStatus("loading");

                while (queueRef.current.length < 2 && !doneRef.current) {
                    await pullMore(10);
                }
                const initial = queueRef.current.splice(0, queueRef.current.length);
                if (!initial.length) { setPlayerStatus("no-rrweb"); return; }

                rrwebZeroTsRef.current = initial[0]?.timestamp || null;
                rrwebFirstTsRef.current = initial[0]?.timestamp || null;

                if (rrwebFirstTsRef.current && ticks.length) {
                    clockOffsetRef.current = ticks[0]._t - rrwebFirstTsRef.current;
                } else {
                    clockOffsetRef.current = 0;
                }
                log("clock offsets", { rrwebFirst: rrwebFirstTsRef.current, tick0: ticks[0]?._t, offset: clockOffsetRef.current });

                const measured = await waitForContainerSize();
                if (!measured) { setPlayerStatus("error"); warn("no measured size"); return; }
                log("init measured size", measured);

                const rep = new Replayer(initial, {
                    root: containerRef.current,
                    liveMode: false,
                    UNSAFE_replayCanvas: true,
                    speed: 1.0,
                    mouseTail: false,
                    width: measured.width,
                    height: measured.height,
                });
                replayerRef.current = rep;
                lastPlayerSizeRef.current = { ...measured };

                // Watch for iframe insertion and sync immediately
                disconnectMO = setupIframeObserver(measured);

                // Also try to sync now (in case iframe is already there later this tick)
                requestAnimationFrame(() => syncIframe(measured, "init-rAF"));

                rep.play();
                setPlayerStatus("playing");

                // poll player time
                const interval = window.setInterval(() => {
                    try {
                        const t = replayerRef.current?.getCurrentTime?.() ?? 0;
                        setCurrentTime(t);
                    } catch (err) {
                        warn("poll current time failed", err);
                    }
                }, POLL_MS);

                // read meta
                try {
                    const meta = rep.getMetaData?.();
                    if (meta) { setPlayerMeta({ totalTime: meta.totalTime ?? 0 }); log("rrweb meta", meta); }
                } catch (err) { warn("read meta failed", err); }

                // feed new events
                (async function feed() {
                    while (!cancelled && replayerRef.current && !doneRef.current) {
                        if (queueRef.current.length < 50) await pullMore(10);
                        const batch = queueRef.current.splice(0, 50);
                        for (const ev of batch) {
                            try { replayerRef.current.addEvent(ev); }
                            catch (err) { warn("addEvent failed", err); }
                        }
                        try {
                            const meta = replayerRef.current?.getMetaData?.();
                            if (meta) setPlayerMeta((p) => ({ totalTime: meta.totalTime ?? p.totalTime }));
                        } catch (err) { warn("refresh meta failed", err); }
                        await new Promise((r) => setTimeout(r, 100));
                    }
                })();

                // mismatch sentinel
                const mismatchSentinel = window.setInterval(() => {
                    const iframe = findIframe();
                    if (!iframe) return;
                    const calc = lastPlayerSizeRef.current;
                    const iW = iframe.clientWidth, iH = iframe.clientHeight;
                    if (calc.width !== iW || calc.height !== iH) {
                        warn("SIZE MISMATCH!", { calc, iframeClient: { w: iW, h: iH } });
                    }
                }, 1000);

                return () => { window.clearInterval(interval); window.clearInterval(mismatchSentinel); };
            } catch (e) {
                warn("replay bootstrap error", e);
                setPlayerStatus("error");
            }
        })();

        return () => {
            cancelled = true;
            try { replayerRef.current?.pause(); } catch {}
            replayerRef.current = null;
            if (disconnectMO) disconnectMO();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    // keep offset if ticks later
    useEffect(() => {
        if (!rrwebFirstTsRef.current || !ticks.length) return;
        clockOffsetRef.current = ticks[0]._t - rrwebFirstTsRef.current;
        log("recomputed offset", clockOffsetRef.current);
    }, [ticks]);

    const isPlaying = playerStatus === "playing";
    const canPlay = playerStatus !== "playing" && playerStatus !== "error" && playerStatus !== "loading";

    const timelineMarkers = useMemo(() => {
        const total = playerMeta.totalTime || 0;
        if (!total) return [];
        const markers = [];
        for (const ev of ticks) {
            const aligned =
                typeof ev._alignedStart === "number" ? ev._alignedStart :
                    typeof ev._alignedEnd === "number" ? ev._alignedEnd :
                        serverToRrwebOffsetMs(ev._t);
            if (typeof aligned !== "number" || !Number.isFinite(aligned)) continue;
            const position = Math.max(0, Math.min(1, aligned / total));
            markers.push({ key: ev.__key, event: ev, position });
        }
        return markers;
    }, [ticks, playerMeta.totalTime, serverToRrwebOffsetMs]);

    useEffect(() => {
        setHoveredMarker((prev) => {
            if (!prev) return null;
            const next = timelineMarkers.find((m) => m.key === prev.key);
            if (!next) return null;
            if (prev.event === next.event && prev.position === next.position) return prev;
            return next;
        });
    }, [timelineMarkers]);

    const updatePlayerSize = React.useCallback((tag = "manual") => {
        const rep = replayerRef.current;
        if (!rep) return;
        const size = measureContainerSize();
        if (!size) return;

        const lastSize = lastPlayerSizeRef.current;
        if (lastSize.width === size.width && lastSize.height === size.height) {
            log(`${tag}: size unchanged`, size);
            return;
        }

        lastPlayerSizeRef.current = size;
        try {
            rep.setConfig?.({ width: size.width, height: size.height });
            log(`${tag}: setConfig`, size);
            syncIframe(size, `${tag}:sync`);
        } catch (err) {
            warn(`${tag}: setConfig failed`, err);
        }
    }, [measureContainerSize, syncIframe]);

    // Resize observer
    useEffect(() => {
        const container = containerRef.current;
        if (!container || typeof ResizeObserver === "undefined") {
            updatePlayerSize("noRO");
            return;
        }
        const observer = new ResizeObserver((entries) => {
            if (!entries.length) { updatePlayerSize("RO-empty"); return; }
            const entry = entries[0];
            const boxSize = Array.isArray(entry.contentBoxSize) ? entry.contentBoxSize[0] : entry.contentBoxSize;
            const width = boxSize?.inlineSize || entry.contentRect?.width;
            const height = boxSize?.blockSize || entry.contentRect?.height;
            if (width && height) {
                const rounded = { width: Math.round(width), height: Math.round(height) };
                const lastSize = lastPlayerSizeRef.current;
                if (lastSize.width !== rounded.width || lastSize.height !== rounded.height) {
                    lastPlayerSizeRef.current = rounded;
                    try {
                        replayerRef.current?.setConfig?.({ width: rounded.width, height: rounded.height });
                        log("RO:setConfig", rounded);
                        syncIframe(rounded, "RO:sync");
                    } catch (err) { warn("RO:setConfig failed", err); }
                } else {
                    log("RO:same size", rounded);
                }
            } else {
                updatePlayerSize("RO-fallback");
            }
        });
        observer.observe(container);
        updatePlayerSize("RO-initial");
        return () => observer.disconnect();
    }, [updatePlayerSize, syncIframe]);

    // --------------- UI ---------------
    const hoverPosition = hoveredMarker ? Math.min(92, Math.max(8, hoveredMarker.position * 100)) : 0;

    const KIND_COLORS = {
        action: "bg-amber-400",
        request: "bg-sky-500",
        db: "bg-emerald-400",
        email: "bg-fuchsia-400",
    };

    const KIND_ICONS = {
        action: "⚡",
        request: "🌐",
        db: "💾",
        email: "✉️",
    };

    function alignedSeekMsFor(ev) {
        const serverMs =
            (typeof ev._startServer === "number" && ev._startServer) ??
            (typeof ev._endServer === "number" && ev._endServer) ??
            (typeof ev._t === "number" && ev._t) ?? null;
        const rrMs = serverToRrwebOffsetMs(serverMs);
        if (rrMs == null) return null;
        const total = replayerRef.current?.getMetaData?.().totalTime ?? 0;
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
            rep.play(target);
            setPlayerStatus("playing");
            setCurrentTime(target);
        } catch (e) { warn("seek failed", e); }

        const key = ev.__key;
        if (key) {
            setActiveEventId(key);
            window.requestAnimationFrame(() => {
                const el = document.getElementById(`event-${key}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            });
        }
    }

    function getMarkerTitle(ev) {
        if (!ev) return "Event";
        if (ev.kind === "action") return ev.label || ev.actionId || "Action";
        if (ev.kind === "request") {
            const parts = [ev.meta?.method, ev.meta?.url].filter(Boolean);
            return parts.join(" ") || "Request";
        }
        if (ev.kind === "db") {
            const parts = [ev.meta?.collection, ev.meta?.op].filter(Boolean);
            return parts.join(" • ") || "Database event";
        }
        if (ev.kind === "email") return ev.meta?.subject || "Email";
        return ev.label || ev.kind || "Event";
    }

    function getMarkerMeta(ev) {
        if (!ev) return null;
        if (ev.kind === "request") {
            const status = ev.meta?.status ?? ev.meta?.statusCode;
            const dur = ev.meta?.durMs ?? ev.meta?.durationMs;
            const parts = [];
            if (status != null) parts.push(`status ${status}`);
            if (dur != null) parts.push(`${dur}ms`);
            return parts.join(" • ") || null;
        }
        if (ev.kind === "db") {
            const parts = [];
            if (ev.meta?.op) parts.push(ev.meta.op);
            if (typeof ev.meta?.durationMs === "number") parts.push(`${ev.meta.durationMs}ms`);
            return parts.join(" • ") || null;
        }
        if (ev.kind === "action") {
            if (typeof ev.tStart === "number" || typeof ev.tEnd === "number") {
                return `[${ev.tStart ?? "—"} … ${ev.tEnd ?? "—"}]`;
            }
            return null;
        }
        if (ev.kind === "email") {
            const parts = [];
            if (ev.meta?.provider) parts.push(ev.meta.provider);
            if (ev.meta?.statusCode != null) parts.push(String(ev.meta.statusCode));
            return parts.join(" • ") || null;
        }
        return null;
    }

    const formatTime = (ms) => {
        if (!Number.isFinite(ms)) return "—";
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };
    const formatMaybeTime = (ms) => (ms == null ? "—" : formatTime(ms));

    return (
        <div className="h-screen w-full overflow-hidden bg-slate-950 text-slate-100">
            <div className="grid h-full w-full grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
                <section className="flex min-h-0 flex-col border-r border-slate-900/60 bg-slate-950/80 backdrop-blur">
                    <div className="flex items-center justify-between border-b border-slate-900/60 px-6 py-4">
                        <div>
                            <h1 className="text-lg font-semibold tracking-tight">Session replay</h1>
                            <p className="text-xs text-slate-400">session {sessionId ?? "—"}</p>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium ${
                  playerStatus === "playing" ? "bg-emerald-500/10 text-emerald-300" :
                      playerStatus === "paused" ? "bg-amber-500/10 text-amber-300" :
                          playerStatus === "loading" ? "bg-sky-500/10 text-sky-300" :
                              playerStatus === "error" ? "bg-rose-500/10 text-rose-300" :
                                  "bg-slate-700/20 text-slate-300"}`}>
                <span className="h-2 w-2 rounded-full bg-current" />
                  {playerStatus}
              </span>
                            <span>{formatTime(currentTime)} / {formatTime(playerMeta.totalTime)}</span>
                        </div>
                    </div>

                    <div className="relative flex-1 min-h-0 px-6 pb-6 pt-4">
                        <div
                            ref={containerRef}
                            className="h-full w-full overflow-hidden rounded-2xl border border-slate-900/40 bg-slate-900/80 shadow-2xl"
                        />
                        {playerStatus === "loading" && (
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                <div className="rounded-full border border-slate-800/80 bg-slate-900/80 px-6 py-3 text-sm text-slate-300 shadow-xl">
                                    Preparing replay…
                                </div>
                            </div>
                        )}
                        {playerStatus === "error" && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="max-w-sm rounded-xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">
                                    Unable to load session replay. Please try again.
                                </div>
                            </div>
                        )}
                        {playerStatus === "no-rrweb" && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="max-w-sm rounded-xl border border-amber-500/40 bg-amber-500/10 px-6 py-4 text-sm text-amber-100">
                                    No rrweb events (or too few) were captured for this session.
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-slate-900/60 bg-slate-950/90 px-6 py-5">
                        <div className="mb-4 flex items-center gap-3 text-sm">
                            <button
                                type="button"
                                onClick={() => {
                                    const rep = replayerRef.current;
                                    if (!rep) return;
                                    if (playerStatus === "playing") {
                                        const now = rep.getCurrentTime?.() ?? currentTime ?? 0;
                                        lastPausedTimeRef.current = now;
                                        rep.pause();
                                        setPlayerStatus("paused");
                                    } else if (canPlay) {
                                        const resumeAt = Number.isFinite(lastPausedTimeRef.current) && lastPausedTimeRef.current >= 0
                                            ? lastPausedTimeRef.current : (rep.getCurrentTime?.() ?? currentTime ?? 0);
                                        rep.play(resumeAt);
                                        setPlayerStatus("playing");
                                    }
                                }}
                                className="inline-flex items-center gap-2 rounded-full border border-slate-800/60 bg-slate-900 px-4 py-2 font-medium text-slate-100 transition hover:border-slate-700 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            >
                <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {playerStatus === "playing" ? "Pause" : "Play"}
                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const rep = replayerRef.current;
                                    if (!rep) return;
                                    rep.pause();
                                    lastPausedTimeRef.current = 0;
                                    rep.play(0);
                                    setPlayerStatus("playing");
                                    setCurrentTime(0);
                                }}
                                className="inline-flex items-center gap-2 rounded-full border border-slate-800/60 bg-slate-900 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-400 transition hover:border-slate-700 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            >
                                Restart
                            </button>
                            <button
                                type="button"
                                onClick={() => updatePlayerSize("manual-click")}
                                className="ml-2 inline-flex items-center gap-2 rounded-full border border-slate-800/60 bg-slate-900 px-3 py-2 text-xs uppercase tracking-[0.2em] text-slate-400"
                            >
                                Resize Now (log)
                            </button>
                            <div className="ml-auto text-xs text-slate-400">
                                {playerStatus === "paused" ? "paused" : "live"}
                            </div>
                        </div>

                        <div className="relative h-20">
                            {hoveredMarker && (
                                <div
                                    className="pointer-events-none absolute z-30 -translate-x-1/2 rounded-xl border border-slate-900/60 bg-slate-950/95 px-3 py-2 text-xs text-slate-200 shadow-2xl backdrop-blur"
                                    style={{ left: `${hoverPosition}%`, bottom: "calc(50% + 24px)" }}
                                >
                                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-500">
                                        <span className={`h-2 w-2 rounded-full ${KIND_COLORS[hoveredMarker.event.kind] || "bg-slate-500"}`} />
                                        {hoveredMarker.event.kind}
                                    </div>
                                    <div className="mt-1 text-sm font-medium leading-snug text-slate-100 break-words">
                                        {getMarkerTitle(hoveredMarker.event)}
                                    </div>
                                    {getMarkerMeta(hoveredMarker.event) && (
                                        <div className="mt-1 text-[11px] uppercase tracking-[0.3em] text-slate-500">
                                            {getMarkerMeta(hoveredMarker.event)}
                                        </div>
                                    )}
                                    <div className="mt-1 text-[11px] text-slate-500">
                                        {formatMaybeTime(alignedSeekMsFor(hoveredMarker.event))} rrweb • @{hoveredMarker.event._t ?? "—"}
                                    </div>
                                </div>
                            )}

                            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2">
                                <div className="relative h-2 w-full rounded-full bg-slate-800/80">
                                    <div
                                        className="absolute inset-y-0 left-0 rounded-full bg-sky-500/70"
                                        style={{ width: `${playerMeta.totalTime ? Math.min(100, (currentTime / playerMeta.totalTime) * 100) : 0}%` }}
                                    />

                                    <div className="pointer-events-none absolute inset-0 z-30">
                                        {timelineMarkers.map((marker) => {
                                            const event = marker.event;
                                            const isActive = activeEventId && event.__key === activeEventId;
                                            const eventTime = alignedSeekMsFor(event);
                                            const markerTitle = getMarkerTitle(event);
                                            const markerIcon = KIND_ICONS[event.kind] || "•";
                                            return (
                                                <button
                                                    key={marker.key || marker.position}
                                                    type="button"
                                                    className={`pointer-events-auto absolute top-1/2 flex h-5 w-5 -translate-y-1/2 -translate-x-1/2 items-center justify-center rounded-full border border-slate-950/70 text-[11px] font-semibold text-slate-950 shadow transition focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${KIND_COLORS[event.kind] || "bg-slate-500"} ${isActive ? "scale-110 ring-2 ring-sky-400/80" : "hover:scale-110"}`}
                                                    style={{ left: `${marker.position * 100}%` }}
                                                    onClick={() => jumpToEvent(event)}
                                                    onMouseEnter={() => setHoveredMarker(marker)}
                                                    onMouseLeave={() => setHoveredMarker(null)}
                                                    onFocus={() => setHoveredMarker(marker)}
                                                    onBlur={() => setHoveredMarker(null)}
                                                    title={`${event.kind || "event"} • ${markerTitle}${eventTime != null ? ` • ${formatMaybeTime(eventTime)}` : ""}`}
                                                >
                                                    <span className="sr-only">{markerTitle}</span>
                                                    <span aria-hidden>{markerIcon}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div
                                    className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-sky-400 bg-slate-950 shadow-[0_0_0_4px_rgba(56,189,248,0.15)] transition"
                                    style={{ left: `${playerMeta.totalTime ? Math.min(100, (currentTime / playerMeta.totalTime) * 100) : 0}%`, transform: "translate(-50%, -50%)" }}
                                />
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={playerMeta.totalTime || replayerRef.current?.getMetaData?.().totalTime || 0}
                                value={currentTime}
                                onChange={(e) => {
                                    const rep = replayerRef.current;
                                    const newTime = Number(e.target.value);
                                    if (!rep) return;
                                    rep.pause();
                                    lastPausedTimeRef.current = newTime;
                                    rep.play(newTime);
                                    setPlayerStatus("playing");
                                    setCurrentTime(newTime);
                                }}
                                className="timeline-slider absolute inset-0 z-10"
                            />
                        </div>
                    </div>
                </section>

                <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950/95">
                    <div className="flex items-center justify-between border-b border-slate-900/60 px-6 py-4">
                        <div>
                            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Timeline</h2>
                            <p className="text-xs text-slate-500">{showAll ? "All backend events" : "Contextual backend events"}</p>
                        </div>
                        <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                            <input
                                type="checkbox"
                                checked={showAll}
                                onChange={(e) => setShowAll(e.target.checked)}
                                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-500"
                            />
                            Show all
                        </label>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
                        {!renderGroups.length && (
                            <div className="text-xs text-slate-500">
                                No backend timeline data for this session.
                            </div>
                        )}

                        <div className="space-y-5">
                            {renderGroups.map((g, gi) => {
                                const action = g.items.find((it) => it.kind === "action");
                                const title = action?.label || action?.actionId || "Other events";
                                const startAligned = action ? serverToRrwebOffsetMs(action.tStart) : null;
                                const endAligned = action ? serverToRrwebOffsetMs(action.tEnd) : null;
                                const windowLabel = action ? `${formatMaybeTime(startAligned)} → ${formatMaybeTime(endAligned)}` : null;

                                return (
                                    <div
                                        key={g.id || gi}
                                        className="rounded-2xl border border-slate-900/60 bg-slate-900/70 shadow-lg backdrop-blur"
                                    >
                                        <div className="flex items-center justify-between border-b border-slate-900/60 px-4 py-3">
                                            <div>
                                                <div className="text-sm font-semibold text-slate-100">{title}</div>
                                                {windowLabel && (
                                                    <div className="text-xs text-slate-500">{windowLabel}</div>
                                                )}
                                            </div>
                                            <div className="text-[11px] uppercase tracking-[0.25em] text-slate-500">
                                                {g.items.length} events
                                            </div>
                                        </div>

                                        <div className="space-y-3 px-4 py-3">
                                            {g.items.map((e, i) => {
                                                const aligned = toRrwebTime(e._t);
                                                const isActive = activeEventId && e.__key === activeEventId;
                                                return (
                                                    <div
                                                        key={e.__key || i}
                                                        id={e.__key ? `event-${e.__key}` : undefined}
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => jumpToEvent(e)}
                                                        onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && jumpToEvent(e)}
                                                        className={`group relative overflow-hidden rounded-xl border px-3 py-3 text-sm transition focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                                                            isActive
                                                                ? "border-sky-500/60 bg-sky-500/10"
                                                                : "border-slate-800/60 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/60"
                                                        }`}
                                                    >
                                                        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.25em] text-slate-500">
                              <span className="flex items-center gap-2">
                                <span className={`h-2 w-2 rounded-full ${KIND_COLORS[e.kind] || "bg-slate-500"}`} />
                                  {e.kind}
                              </span>
                                                            <span>
                                @{e._t ?? "—"} • {typeof aligned === "number" ? `${Math.round(aligned)}ms` : "—"}
                              </span>
                                                        </div>

                                                        {e.kind === "request" && (
                                                            <div className="space-y-1">
                                                                <div className="font-mono text-xs text-slate-200">
                                                                    {e.meta?.method} {e.meta?.url}
                                                                </div>
                                                                <div className="text-xs text-slate-400">
                                                                    status {e.meta?.status} • {e.meta?.durMs}ms
                                                                </div>
                                                            </div>
                                                        )}
                                                        {e.kind === "db" && (
                                                            <div className="space-y-2 text-xs text-slate-300">
                                                                <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
                                                                    {e.meta?.collection} • {e.meta?.op}
                                                                </div>
                                                                {e.meta?.query && (
                                                                    <pre className="max-h-36 overflow-auto rounded-lg bg-slate-950/70 p-3 text-[11px] leading-relaxed text-slate-300">
                                    {JSON.stringify(e.meta.query, null, 2)}
                                  </pre>
                                                                )}
                                                                {e.meta?.resultMeta && (
                                                                    <div className="text-[11px] text-slate-400">
                                                                        result {JSON.stringify(e.meta.resultMeta)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        {e.kind === "action" && (
                                                            <div className="space-y-1 text-xs text-slate-200">
                                                                <div className="font-mono text-sm">{e.label || e.actionId}</div>
                                                                {(typeof e.tStart === "number" || typeof e.tEnd === "number") && (
                                                                    <div className="text-[11px] text-slate-400">
                                                                        [{e.tStart ?? "—"} … {e.tEnd ?? "—"}]
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        {e.kind === "email" && (
                                                            <div className="text-xs text-slate-200">
                                                                <EmailItem meta={e.meta} />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}

                            {!renderGroups.length && !showAll && (
                                <div className="rounded-xl border border-slate-900/60 bg-slate-900/70 px-4 py-3 text-xs text-slate-400">
                                    No events near the current time. Try{" "}
                                    <button className="text-sky-400 underline" onClick={() => setShowAll(true)}>
                                        showing all
                                    </button>
                                    .
                                </div>
                            )}
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}
