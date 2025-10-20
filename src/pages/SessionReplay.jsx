import React, { useEffect, useMemo, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/rrweb.min.css";
import useTimeline from "../hooks/useTimeline";
import { decodeBase64JsonArray } from "../lib/rrwebDecode";
import EmailItem from "../components/EmailItem.jsx";
import { FunctionTraceViewer } from "../components/FunctionTracerViewer.jsx";
import useSessionTraces from "../hooks/useSessionTraces.js";
import "../components/SessionReply.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const WINDOW_MS = 1500;
const POLL_MS = 200;

// ===== DEBUG =====
const DEBUG = false;
const log = (...a) => DEBUG && console.log("[repro:replay]", ...a);
const warn = (...a) => DEBUG && console.warn("[repro:replay]", ...a);

// rank order inside one action group
const KIND_RANK = { action: 0, request: 1, db: 2, email: 3 };

function LogoMark({ className = "", ...props }) {
    return (
        <svg
            viewBox="0 0 48 48"
            role="img"
            aria-label="Replay logo"
            className={className}
            {...props}
        >
            <rect width="48" height="48" fill="#0f172a" />
            <path d="M10 8h8v32h-8z" fill="#1d4ed8" />
            <path
                d="M20 8h14c7.2 0 12 4.16 12 10.52 0 4.74-2.72 8.2-7.38 9.7l7.9 11.78H35.8l-7.38-9.3H28v9.3h-8V8Zm8 7.12v7.32h6.07c2.5 0 4.05-1.3 4.05-3.66 0-2.34-1.55-3.66-4.05-3.66Z"
                fill="#f8fafc"
            />
        </svg>
    );
}

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

    const resetStream = React.useCallback(() => {
        const first = Math.max(0, Number(meta?.firstSeq || 0));
        queueRef.current = [];
        nextSeqRef.current = first;
        doneRef.current = false;
        log("resetStream", { first });
    }, [meta?.firstSeq]);

    return { meta, status, queueRef, pullMore, doneRef, resetStream };
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
    const progressTrackRef = useRef(null);
    const scrubCleanupRef = useRef(null);
    const rrwebZeroTsRef = useRef(null);
    const lastPausedTimeRef = useRef(0);
    const lastPlayerSizeRef = useRef({ width: 0, height: 0 });

    const { status, queueRef, pullMore, doneRef, resetStream } = useRrwebStream(sessionId);
    const rawTicks = useTimeline(sessionId);
    const { status: traceStatus, entries: traceEntries } = useSessionTraces(sessionId);

    const [currentTime, setCurrentTime] = useState(0);
    const [playerStatus, setPlayerStatus] = useState("idle");
    const [showAll, setShowAll] = useState(false);
    const [playerMeta, setPlayerMeta] = useState({ totalTime: 0 });
    const [hoveredMarker, setHoveredMarker] = useState(null);
    const [activeEventId, setActiveEventId] = useState(null);
    const [viewMode, setViewMode] = useState("replay");
    const [selectedTraceId, setSelectedTraceId] = useState(null);
    const [collapsedGroups, setCollapsedGroups] = useState({});

    const rrwebFirstTsRef = useRef(null);
    const clockOffsetRef = useRef(0);

    useEffect(() => {
        setViewMode("replay");
        setSelectedTraceId(null);
        setShowAll(false);
        setCollapsedGroups({});
    }, [sessionId]);

    useEffect(() => {
        setCollapsedGroups({});
    }, [showAll]);

    useEffect(() => {
        if (viewMode !== "replay") return;
        if (status !== "ready") return;
        resetStream();
    }, [viewMode, status, resetStream]);

    useEffect(() => {
        if (!traceEntries.length) {
            setSelectedTraceId(null);
            return;
        }
        if (selectedTraceId && !traceEntries.find((entry) => entry.id === selectedTraceId)) {
            setSelectedTraceId(null);
        }
    }, [traceEntries, selectedTraceId]);

    const selectedTrace = useMemo(() => {
        if (!traceEntries.length || !selectedTraceId) return null;
        return traceEntries.find((entry) => entry.id === selectedTraceId) || null;
    }, [traceEntries, selectedTraceId]);

    const traceTitle = selectedTrace
        ? `${selectedTrace.label || "Function trace"} (${selectedTrace.total || selectedTrace.events.length || 0} events)`
        : "Function trace";

    const traceSummaryText = useMemo(() => {
        if (traceStatus === "loading") return "Loading traces…";
        if (traceStatus === "error") return "Failed to load traces";
        if (traceEntries.length) {
            const count = traceEntries.length;
            const suffix = count === 1 ? "trace" : "traces";
            if (!selectedTraceId) {
                return `${count} ${suffix} • Select to inspect`;
            }
            return `${count} ${suffix}`;
        }
        if (traceStatus === "ready") return "No traces captured";
        return "Trace inspector";
    }, [traceEntries.length, traceStatus, selectedTraceId]);

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

    // ---- iframe helpers (contain scaling) ----
    const findIframe = React.useCallback(() => {
        const root = containerRef.current;
        if (!root) return null;
        return root.querySelector("iframe");
    }, []);

    const measureIframeContentSize = React.useCallback(() => {
        const iframe = findIframe();
        if (!iframe) return null;
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!doc) return null;
            const de = doc.documentElement;
            const body = doc.body;
            const innerW = iframe.contentWindow?.innerWidth || 0;
            const innerH = iframe.contentWindow?.innerHeight || 0;
            const clientW = Math.max(de?.clientWidth || 0, body?.clientWidth || 0);
            const clientH = Math.max(de?.clientHeight || 0, body?.clientHeight || 0);
            const scrollW = Math.max(de?.scrollWidth || 0, body?.scrollWidth || 0);
            const scrollH = Math.max(de?.scrollHeight || 0, body?.scrollHeight || 0);

            const w = innerW || clientW || scrollW || 0;
            const h = innerH || clientH || scrollH || 0;

            const size = { width: Math.round(w), height: Math.round(h) };
            log("measureIframeContentSize", { innerW, innerH, clientW, clientH, scrollW, scrollH, pick: size });
            return size.width && size.height ? size : null;
        } catch (e) {
            warn("measureIframeContentSize failed", e);
            return null;
        }
    }, [findIframe]);

    const applyFitContain = React.useCallback((tag = "fit") => {
        const cont = measureContainerSize();
        const intrinsic = measureIframeContentSize();
        const iframe = findIframe();
        if (!cont || !intrinsic || !iframe) {
            warn(`${tag}: missing sizes`, { cont, intrinsic, hasIframe: !!iframe });
            return;
        }

        iframe.style.backgroundColor = "#ffffff";
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc?.documentElement) {
                doc.documentElement.style.backgroundColor = "#ffffff";
            }
            if (doc?.body) {
                doc.body.style.backgroundColor = "#ffffff";
            }
        } catch (err) {
            warn(`${tag}: unable to set iframe background`, err);
        }

        const scale = Math.min(cont.width / intrinsic.width, cont.height / intrinsic.height, 1); // cap at 1 (no upscale)
        const scaledW = Math.round(intrinsic.width * scale);
        const scaledH = Math.round(intrinsic.height * scale);

        // iframe intrinsic size + scale
        iframe.style.width = `${intrinsic.width}px`;
        iframe.style.height = `${intrinsic.height}px`;
        iframe.setAttribute("width", String(intrinsic.width));
        iframe.setAttribute("height", String(intrinsic.height));
        iframe.style.transform = `scale(${scale})`;
        iframe.style.transformOrigin = "top left";
        iframe.style.display = "block";

        // reserve scaled space on wrapper (rrweb root parent of iframe)
        const wrapper = iframe.parentElement;
        if (wrapper) {
            wrapper.style.width = `${scaledW}px`;
            wrapper.style.height = `${scaledH}px`;
            wrapper.style.overflow = "hidden";
            wrapper.style.background = "#ffffff";
        }

        // container should hide overflow as well
        const root = containerRef.current;
        if (root) {
            root.style.overflow = "hidden";
            root.style.background = "#ffffff";
        }

        log(`${tag}: applyFitContain`, { container: cont, intrinsic, scale, scaled: { w: scaledW, h: scaledH } });
    }, [findIframe, measureContainerSize, measureIframeContentSize]);

    // ---- alignment helpers ----
    const serverToRrwebOffsetMs = React.useCallback((serverMs) => {
        if (typeof serverMs !== "number") return null;
        const rrFirst = rrwebFirstTsRef.current;
        const offset = clockOffsetRef.current ?? 0;
        if (typeof rrFirst !== "number") return null;
        const virtual = serverMs - offset - rrFirst;
        return Number.isFinite(virtual) ? Math.max(0, virtual) : null;
    }, []);

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

    const timelineSummaryText = useMemo(() => {
        if (!renderGroups.length) {
            return showAll ? "No backend events" : "No contextual events";
        }
        const total = renderGroups.reduce((sum, group) => sum + group.items.length, 0);
        const actionLabel = renderGroups.length === 1 ? "action" : "actions";
        const eventLabel = total === 1 ? "event" : "events";
        return `${total} ${eventLabel} across ${renderGroups.length} ${actionLabel}`;
    }, [renderGroups, showAll]);

    // ---- bootstrap rrweb ----
    useEffect(() => {
        if (viewMode !== "replay") {
            return;
        }

        if (status !== "ready" || !containerRef.current || replayerRef.current) return;

        let cancelled = false;
        let mo = null;
        let viewportProbe = null;
        let mismatchSentinel = null;

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

                let measured = await waitForContainerSize();
                if (!measured) {
                    measured = { width: 1280, height: 720 };
                    warn("no measured size, falling back to", measured);
                }
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

                // Observe iframe insertion -> first fit
                mo = new MutationObserver(() => {
                    const iframe = findIframe();
                    if (iframe) {
                        log("MutationObserver: iframe appeared");
                        requestAnimationFrame(() => applyFitContain("init-fit"));
                    }
                });
                mo.observe(containerRef.current, { childList: true, subtree: true });

                // Also try a frame later
                requestAnimationFrame(() => applyFitContain("init-rAF-fit"));

                rep.play();
                setPlayerStatus("playing");

                // poll player time
                const interval = window.setInterval(() => {
                    try {
                        const t = replayerRef.current?.getCurrentTime?.() ?? 0;
                        setCurrentTime(t);
                    } catch (err) { warn("poll current time failed", err); }
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

                // mismatch logger (debug)
                mismatchSentinel = window.setInterval(() => {
                    const iframe = findIframe();
                    if (!iframe) return;
                    const cont = measureContainerSize();
                    const intrinsic = measureIframeContentSize();
                    if (!cont || !intrinsic) return;
                    const scale = Math.min(cont.width / intrinsic.width, cont.height / intrinsic.height, 1);
                    const rect = iframe.getBoundingClientRect();
                    if (scale < 1 && (rect.width > cont.width + 1 || rect.height > cont.height + 1)) {
                        warn("SIZE MISMATCH (should fit but overflows)", { cont, intrinsic, scale, iframeRect: { w: rect.width, h: rect.height } });
                    }
                }, 1500);

                // probe viewport periodically (if rrweb resizes its internal viewport)
                viewportProbe = window.setInterval(() => applyFitContain("probe-fit"), 1500);

                return () => {
                    window.clearInterval(interval);
                };
            } catch (e) {
                warn("replay bootstrap error", e);
                setPlayerStatus("error");
            }
        })();

        return () => {
            cancelled = true;
            try {
                replayerRef.current?.pause();
            } catch (err) {
                warn("pause during cleanup failed", err);
            }
            replayerRef.current = null;
            if (mo) mo.disconnect();
            if (viewportProbe) clearInterval(viewportProbe);
            if (mismatchSentinel) clearInterval(mismatchSentinel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, viewMode]);

    useEffect(() => {
        if (viewMode === "replay") return;
        try {
            replayerRef.current?.pause();
        } catch (err) {
            warn("pause on view switch failed", err);
        }
        replayerRef.current = null;
        setPlayerStatus((prev) => (prev === "playing" ? "paused" : prev));
    }, [viewMode]);

    // recompute offset if ticks later
    useEffect(() => {
        if (!rrwebFirstTsRef.current || !ticks.length) return;
        clockOffsetRef.current = ticks[0]._t - rrwebFirstTsRef.current;
        log("recomputed offset", clockOffsetRef.current);
    }, [ticks]);

    // container resize → refit (contain)
    useEffect(() => {
        const container = containerRef.current;
        if (!container || typeof ResizeObserver === "undefined") {
            applyFitContain("noRO-fit");
            return;
        }
        const observer = new ResizeObserver(() => {
            applyFitContain("RO-fit");
        });
        observer.observe(container);
        applyFitContain("RO-initial-fit");
        return () => observer.disconnect();
    }, [applyFitContain]);

    const getTotalDuration = React.useCallback(() => {
        const metaTotal = replayerRef.current?.getMetaData?.().totalTime;
        if (Number.isFinite(metaTotal) && metaTotal > 0) return metaTotal;
        return playerMeta.totalTime || 0;
    }, [playerMeta.totalTime]);

    const seekToTime = React.useCallback(
        (ms, { autoPlay = true } = {}) => {
            const rep = replayerRef.current;
            const total = getTotalDuration();
            const clamped = Math.max(0, Math.min(total || 0, Number.isFinite(ms) ? ms : 0));

            lastPausedTimeRef.current = clamped;
            setCurrentTime(clamped);

            if (!rep) return;

            try {
                rep.pause();
                rep.play(clamped);
                if (!autoPlay) {
                    rep.pause();
                    setPlayerStatus("paused");
                } else {
                    setPlayerStatus("playing");
                }
            } catch (err) {
                warn("seek failed", err);
            }
        },
        [getTotalDuration]
    );

    const totalDuration = getTotalDuration();
    const progressPercent = totalDuration ? Math.min(100, (currentTime / totalDuration) * 100) : 0;

    const timelineMarkers = useMemo(() => {
        if (!totalDuration) return [];
        const markers = [];
        for (const ev of ticks) {
            const aligned =
                typeof ev._alignedStart === "number" ? ev._alignedStart :
                    typeof ev._alignedEnd === "number" ? ev._alignedEnd :
                        serverToRrwebOffsetMs(ev._t);
            if (typeof aligned !== "number" || !Number.isFinite(aligned)) continue;
            const position = Math.max(0, Math.min(1, aligned / totalDuration));
            markers.push({ key: ev.__key, event: ev, position });
        }
        return markers;
    }, [ticks, totalDuration, serverToRrwebOffsetMs]);

    useEffect(() => {
        setHoveredMarker((prev) => {
            if (!prev) return null;
            const next = timelineMarkers.find((m) => m.key === prev.key);
            if (!next) return null;
            if (prev.event === next.event && prev.position === next.position) return prev;
            return next;
        });
    }, [timelineMarkers]);

    function alignedSeekMsFor(ev) {
        const aligned =
            (typeof ev._alignedStart === "number" && ev._alignedStart) ??
            (typeof ev._alignedEnd === "number" && ev._alignedEnd) ??
            null;

        const serverMs =
            (typeof ev._startServer === "number" && ev._startServer) ??
            (typeof ev._endServer === "number" && ev._endServer) ??
            (typeof ev._t === "number" && ev._t) ??
            null;

        const rrMs =
            aligned ??
            serverToRrwebOffsetMs(serverMs);
        if (rrMs == null) return null;
        const total = getTotalDuration();
        return Math.max(0, Math.min(total || 0, rrMs));
    }

    const findTraceForEvent = React.useCallback(
        (ev) => {
            if (!ev || !traceEntries.length) return null;
            const meta = ev.meta || {};
            const eventHints = [
                ev.actionId,
                ev.id,
                ev.ui?.traceHint,
                ev.ui?.traceId,
                ev.ui?.trace_id,
                ev.ui?.requestRid,
                ev.ui?.rid,
                ev.ui?.groupKey,
                ev.ui?.key,
                ev.label,
            ].filter(Boolean);

            const traceHints = [
                meta.traceId,
                meta.trace_id,
                meta.requestTraceId,
                meta.requestRid,
                meta.rid,
                meta.id,
                meta.traceHint,
            ].filter(Boolean);

            const allHints = [...traceHints, ...eventHints];

            const matchesHint = (entry, hint) => {
                if (!hint) return false;
                const req = entry.request || {};
                return (
                    entry.id === hint ||
                    entry.groupKey === hint ||
                    entry.requestRid === hint ||
                    entry.label === hint ||
                    req.traceId === hint ||
                    req.requestRid === hint ||
                    req.rid === hint ||
                    req.key === hint ||
                    req.actionId === hint
                );
            };

            for (const hint of allHints) {
                const direct = traceEntries.find(
                    (entry) => matchesHint(entry, hint)
                );
                if (direct) return direct;
            }

            const keyMatches = [meta.key, meta.urlKey, meta.name].filter(Boolean);
            for (const key of keyMatches) {
                const match = traceEntries.find(
                    (entry) => entry.label === key || entry.request?.key === key || entry.groupKey === key
                );
                if (match) return match;
            }

            if (meta.method && meta.url) {
                const method = String(meta.method).toUpperCase();
                const url = String(meta.url);
                const match = traceEntries.find((entry) => {
                    const req = entry.request || {};
                    return (
                        req.method && req.url &&
                        String(req.method).toUpperCase() === method &&
                        String(req.url) === url
                    );
                });
                if (match) return match;
            }

            if (ev.actionId) {
                const actionMatch = traceEntries.find((entry) => {
                    const req = entry.request || {};
                    return entry.groupKey === ev.actionId || req.actionId === ev.actionId;
                });
                if (actionMatch) return actionMatch;
            }

            return null;
        },
        [traceEntries]
    );

    function jumpToEvent(ev) {
        const target = alignedSeekMsFor(ev);
        if (target == null) return;

        seekToTime(target);
        const key = ev.__key;
        if (key) {
            setActiveEventId(key);
            window.requestAnimationFrame(() => {
                const el = document.getElementById(`event-${key}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            });
        }

        if (ev.kind === "request" || ev.kind === "action") {
            const matchedTrace = findTraceForEvent(ev);
            if (matchedTrace) {
                setSelectedTraceId(matchedTrace.id);
                setViewMode("trace");
            } else if (traceEntries.length) {
                setViewMode("trace");
                setSelectedTraceId((prev) => prev ?? traceEntries[0].id);
            }
        }
    }

    const handleProgressSeek = React.useCallback(
        (clientX) => {
            const track = progressTrackRef.current;
            if (!track) return;
            const rect = track.getBoundingClientRect();
            if (!rect || rect.width <= 0) return;
            const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
            const total = getTotalDuration();
            const nextTime = ratio * (total || 0);
            seekToTime(nextTime);
        },
        [getTotalDuration, seekToTime]
    );

    const startProgressScrub = React.useCallback(
        (clientX) => {
            if (scrubCleanupRef.current) {
                scrubCleanupRef.current();
            }
            handleProgressSeek(clientX);
            const onMove = (ev) => {
                ev.preventDefault();
                handleProgressSeek(ev.clientX);
            };
            const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
                scrubCleanupRef.current = null;
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            scrubCleanupRef.current = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
                scrubCleanupRef.current = null;
            };
        },
        [handleProgressSeek]
    );

    const shouldSkipTrackEvent = (target) => {
        if (!target || typeof target.closest !== "function") return false;
        if (target.closest("button")) return true;
        if (target.closest("input")) return true;
        return false;
    };

    const onTrackMouseDown = React.useCallback(
        (ev) => {
            if (shouldSkipTrackEvent(ev.target)) return;
            ev.preventDefault();
            startProgressScrub(ev.clientX);
        },
        [startProgressScrub]
    );

    const onTrackTouch = React.useCallback(
        (ev) => {
            if (shouldSkipTrackEvent(ev.target)) return;
            const touch = ev.touches[0];
            if (!touch) return;
            ev.preventDefault();
            handleProgressSeek(touch.clientX);
        },
        [handleProgressSeek]
    );

    useEffect(() => () => {
        if (scrubCleanupRef.current) {
            scrubCleanupRef.current();
        }
    }, []);

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

    const KIND_COLORS = {
        action: "bg-amber-500",
        request: "bg-blue-500",
        db: "bg-cyan-500",
        email: "bg-violet-500",
    };

    const KIND_ACCENT_COLORS = {
        action: "#f59e0b",
        request: "#2563eb",
        db: "#0891b2",
        email: "#7c3aed",
        default: "#94a3b8",
    };

    const KIND_ICON_COMPONENTS = {
        action: (props) => (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
                <path d="M5 3l10 7-10 7V3z" />
            </svg>
        ),
        request: (props) => (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
                <circle cx="10" cy="10" r="8" />
                <path d="M10 6v4l2 2" />
            </svg>
        ),
        db: (props) => (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
                <ellipse cx="10" cy="4" rx="6" ry="2" />
                <path d="M4 4v12c0 1.1 2.7 2 6 2s6-.9 6-2V4" />
                <path d="M4 10c0 1.1 2.7 2 6 2s6-.9 6-2" />
            </svg>
        ),
        email: (props) => (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
                <rect x="3" y="5" width="14" height="10" rx="2" />
                <path d="M3 6l7 5 7-5" />
            </svg>
        ),
        default: (props) => (
            <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
                <circle cx="10" cy="10" r="4" />
            </svg>
        ),
    };

    function MarkerIcon({ kind, className }) {
        const Icon = KIND_ICON_COMPONENTS[kind] || KIND_ICON_COMPONENTS.default;
        return <Icon className={`h-4 w-4 ${className}`} />;
    }


    const playbackSection = (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-8 py-5">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Playback</p>
                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">Session replay</h2>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-600">
                    <span
                        className={`flex items-center gap-2 border px-3 py-1 font-medium uppercase tracking-[0.2em] ${
                            playerStatus === "playing"
                                ? "border-emerald-600 text-emerald-600"
                                : playerStatus === "paused"
                                    ? "border-amber-600 text-amber-600"
                                    : playerStatus === "loading"
                                        ? "border-sky-600 text-sky-600"
                                        : playerStatus === "error"
                                            ? "border-rose-600 text-rose-600"
                                            : "border-slate-400 text-slate-500"
                        }`}
                    >
                        {playerStatus}
                    </span>
                    <span className="font-medium text-slate-500">
                        {formatTime(currentTime)} / {formatTime(totalDuration)}
                    </span>
                </div>
            </div>

            <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden bg-slate-100 px-8 py-6">
                <div ref={containerRef} className="h-full w-full border border-slate-300 bg-white" />
                {playerStatus === "loading" && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="border border-slate-300 bg-white px-6 py-3 text-sm text-slate-600">
                            Preparing replay…
                        </div>
                    </div>
                )}
                {playerStatus === "error" && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="border border-rose-400 bg-rose-50 px-6 py-4 text-sm text-rose-700">
                            Unable to load session replay. Please try again.
                        </div>
                    </div>
                )}
                {playerStatus === "no-rrweb" && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="border border-amber-400 bg-amber-50 px-6 py-4 text-sm text-amber-700">
                            No rrweb events (or too few) were captured for this session.
                        </div>
                    </div>
                )}
            </div>

            <div className="border-t border-slate-200 bg-white px-8 py-5">
                <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
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
                            } else if (playerStatus !== "error" && playerStatus !== "loading") {
                                const resumeAt =
                                    Number.isFinite(lastPausedTimeRef.current) && lastPausedTimeRef.current >= 0
                                        ? lastPausedTimeRef.current
                                        : rep.getCurrentTime?.() ?? currentTime ?? 0;
                                rep.play(resumeAt);
                                setPlayerStatus("playing");
                            }
                        }}
                        className="inline-flex items-center border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                        <span>{playerStatus === "playing" ? "Pause" : "Play"}</span>
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
                        className="inline-flex items-center border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                        Restart
                    </button>
                    <button
                        type="button"
                        onClick={() => applyFitContain("manual-fit")}
                        className="ml-2 inline-flex items-center border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 hover:bg-slate-100"
                    >
                        Refit now
                    </button>
                    <div className="ml-auto text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        {playerStatus === "paused" ? "paused" : "live"}
                    </div>
                </div>

                <div className="relative h-20">
                    <div
                        ref={progressTrackRef}
                        className="absolute inset-x-0 top-1/2 -translate-y-1/2"
                        onMouseDown={onTrackMouseDown}
                        onTouchStart={onTrackTouch}
                        onTouchMove={onTrackTouch}
                    >
                        <div className="relative h-2 w-full bg-slate-200">
                            <div
                                className="absolute inset-y-0 left-0 bg-sky-500"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>

                        <div className="pointer-events-none absolute inset-0 z-50">
                            {timelineMarkers.map((marker) => {
                                const event = marker.event;
                                const isActive = activeEventId && event.__key === activeEventId;
                                const eventTime = alignedSeekMsFor(event);
                                const markerTitle = getMarkerTitle(event);
                                return (
                                    <button
                                        key={marker.key || marker.position}
                                        type="button"
                                        className={`pointer-events-auto absolute top-1/2 flex h-8 w-8 -translate-y-1/2 -translate-x-1/2 items-center justify-center border border-white text-slate-900 transition focus:outline-none focus:ring-2 focus:ring-sky-400 ${KIND_COLORS[event.kind] || "bg-slate-500"} ${isActive ? "ring-2 ring-sky-300" : "hover:opacity-90"}`}
                                        style={{ left: `${marker.position * 100}%` }}
                                        onClick={() => jumpToEvent(event)}
                                        onMouseEnter={() => setHoveredMarker(marker)}
                                        onMouseLeave={() => setHoveredMarker(null)}
                                        onFocus={() => setHoveredMarker(marker)}
                                        onBlur={() => setHoveredMarker(null)}
                                        title={`${event.kind || "event"} • ${markerTitle}${eventTime != null ? ` • ${formatMaybeTime(eventTime)}` : ""}`}
                                    >
                                        <MarkerIcon kind={event.kind} className="text-white" />
                                    </button>
                                );
                            })}
                        </div>

                        <div
                            className="absolute top-1/2 z-40 h-4 w-4 -translate-y-1/2 border-2 border-sky-400 bg-white"
                            style={{
                                left: `${playerMeta.totalTime ? Math.min(100, (currentTime / playerMeta.totalTime) * 100) : 0}%`,
                                transform: "translate(-50%, -50%)",
                            }}
                        />
                    </div>

                    <input
                        type="range"
                        min={0}
                        max={totalDuration}
                        value={Math.min(totalDuration, currentTime)}
                        onChange={(e) => {
                            const newTime = Number(e.target.value);
                            seekToTime(newTime);
                        }}
                        className="timeline-slider absolute inset-0 z-30 appearance-none bg-transparent"
                    />

                    {hoveredMarker && (() => {
                        const { event } = hoveredMarker;
                        const x = Math.min(92, Math.max(8, hoveredMarker.position * 100));
                        const sub = getMarkerMeta(event);
                        return (
                            <div
                                className="pointer-events-none absolute z-50 -translate-x-1/2 border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                                style={{ left: `${x}%`, bottom: "calc(50% + 24px)" }}
                            >
                                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-500">
                                    <span className={`h-2 w-2 ${KIND_COLORS[event.kind] || "bg-slate-500"}`} />
                                    {event.kind}
                                </div>
                                <div className="mt-1 break-words text-sm font-medium leading-snug text-slate-900">{getMarkerTitle(event)}</div>
                                {sub && <div className="mt-1 text-[11px] uppercase tracking-[0.3em] text-slate-400">{sub}</div>}
                                <div className="mt-1 text-[11px] text-slate-500">{formatMaybeTime(alignedSeekMsFor(event))} rrweb • @{event._t ?? "—"}</div>
                            </div>
                        );
                    })()}
                </div>
            </div>
        </section>
    );

    const timelinePanel = (
        <aside className="flex h-full min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
            <div className="border-b border-slate-200 px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Timeline</p>
                        <h2 className="text-sm font-semibold text-slate-900">
                            {showAll ? "All backend events" : "Contextual backend events"}
                        </h2>
                    </div>
                    <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                        <input
                            type="checkbox"
                            checked={showAll}
                            onChange={(e) => setShowAll(e.target.checked)}
                            className="h-4 w-4 border-slate-400 text-sky-600 focus:ring-sky-500"
                        />
                        Show all
                    </label>
                </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-5">
                {!renderGroups.length && (
                    <div className="border border-dashed border-slate-300 bg-slate-100 px-4 py-5 text-xs text-slate-600">
                        {showAll
                            ? "No backend timeline data for this session."
                            : "No events near the current playback time."}
                    </div>
                )}
                <div className="min-w-0 space-y-4">
                    {renderGroups.map((g, gi) => {
                        const groupKey = g.id || `group-${gi}`;
                        const isCollapsed = Boolean(collapsedGroups[groupKey]);
                        const action = g.items.find((it) => it.kind === "action");
                        const title = action?.label || action?.actionId || "Other events";
                        const startAligned = action ? serverToRrwebOffsetMs(action.tStart) : null;
                        const endAligned = action ? serverToRrwebOffsetMs(action.tEnd) : null;
                        const windowLabel = action ? `${formatMaybeTime(startAligned)} → ${formatMaybeTime(endAligned)}` : null;

                        return (
                            <div key={groupKey} className="w-full border border-slate-200 bg-white">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setCollapsedGroups((prev) => {
                                            const next = { ...prev };
                                            next[groupKey] = !isCollapsed;
                                            return next;
                                        })
                                    }
                                    aria-expanded={!isCollapsed}
                                    className="flex w-full items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
                                >
                                    <div className="space-y-1">
                                        <div className="text-sm font-semibold text-slate-900">{title}</div>
                                        <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.25em] text-slate-500">
                                            <span>{g.items.length} events</span>
                                            {windowLabel && <span>{windowLabel}</span>}
                                        </div>
                                    </div>
                                    <span className="text-slate-400">{isCollapsed ? "▸" : "▾"}</span>
                                </button>

                                {!isCollapsed && (
                                    <div className="divide-y divide-slate-200">
                                        {g.items.map((e, ei) => {
                                            const isEventActive = activeEventId && e.__key === activeEventId;
                                            const eventKey = `${groupKey}-${ei}`;
                                            const isRequest = e.kind === "request";
                                            const isDb = e.kind === "db";
                                            const isEmail = e.kind === "email";
                                            const isAction = e.kind === "action";

                                            return (
                                                <button
                                                    id={`event-${e.__key}`}
                                                    key={eventKey}
                                                    type="button"
                                                    onClick={() => jumpToEvent(e)}
                                                    className={`flex w-full flex-col gap-3 px-4 py-3 text-left transition ${
                                                        isEventActive ? "bg-slate-100" : "hover:bg-slate-50"
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between gap-4">
                                                        <div className="flex min-w-0 items-start gap-3">
                                                            <span className={`h-2 w-2 ${KIND_COLORS[e.kind] || "bg-slate-500"}`} />
                                                            <div className="min-w-0">
                                                                <div className="break-words text-sm font-semibold text-slate-900">{getMarkerTitle(e)}</div>
                                                                <div className="mt-1 text-[11px] uppercase tracking-[0.28em] text-slate-400">{e.kind}</div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right text-xs text-slate-500">
                                                            <div>{formatMaybeTime(alignedSeekMsFor(e))}</div>
                                                            {typeof e._t === "number" && <div className="font-mono text-[11px] text-slate-400">@{e._t}</div>}
                                                        </div>
                                                    </div>

                                                    {isRequest && (
                                                        <div className="space-y-2 text-xs text-slate-600">
                                                            <div className="break-words font-mono text-sm text-slate-900">
                                                                {e.meta?.method} {e.meta?.url}
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-slate-500">
                                                                {e.meta?.status != null && <span>Status {e.meta.status}</span>}
                                                                {e.meta?.durMs != null && <span>{e.meta.durMs}ms</span>}
                                                                {typeof e.meta?.size === "number" && <span>{e.meta.size} bytes</span>}
                                                            </div>
                                                            {e.meta?.body && (
                                                                <pre className="max-h-40 max-w-full overflow-auto border border-slate-300 bg-slate-100 p-3 text-[11px] leading-relaxed text-slate-700">
                                                                    {JSON.stringify(e.meta.body, null, 2)}
                                                                </pre>
                                                            )}
                                                            {e.meta?.response && (
                                                                <pre className="max-h-40 max-w-full overflow-auto border border-slate-300 bg-slate-100 p-3 text-[11px] leading-relaxed text-slate-700">
                                                                    {JSON.stringify(e.meta.response, null, 2)}
                                                                </pre>
                                                            )}
                                                        </div>
                                                    )}
                                                    {isDb && (
                                                        <div className="space-y-2 text-xs text-slate-600">
                                                            <div className="break-words font-mono text-sm text-slate-900">
                                                                {e.meta?.collection} • {e.meta?.op}
                                                            </div>
                                                            {e.meta?.query && (
                                                                <pre className="max-h-36 max-w-full overflow-auto border border-slate-300 bg-slate-100 p-3 text-[11px] leading-relaxed text-slate-700">
                                                                    {JSON.stringify(e.meta.query, null, 2)}
                                                                </pre>
                                                            )}
                                                            {e.meta?.resultMeta && (
                                                                <div className="text-[11px] text-slate-500">result {JSON.stringify(e.meta.resultMeta)}</div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {isAction && (
                                                        <div className="space-y-1 text-xs text-slate-600">
                                                            <div className="break-words font-mono text-sm text-slate-900">{e.label || e.actionId}</div>
                                                            {(typeof e.tStart === "number" || typeof e.tEnd === "number") && (
                                                                <div className="text-[11px] text-slate-500">[{e.tStart ?? "—"} … {e.tEnd ?? "—"}]</div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {isEmail && (
                                                        <div className="text-xs text-slate-600">
                                                            <EmailItem meta={e.meta} />
                                                        </div>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </aside>
    );

    const tracePanelContent = (
        <>
            <div className="border-b border-slate-200 px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Function traces</p>
                        <h2 className="text-sm font-semibold text-slate-900">{traceTitle}</h2>
                    </div>
                    <span className="text-[11px] uppercase tracking-[0.25em] text-slate-500">{traceSummaryText}</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">Select a request to inspect its captured trace.</p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-5">
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                    {traceStatus === "loading" && !traceEntries.length && (
                        <div className="border border-slate-200 bg-slate-100 px-4 py-4 text-xs text-slate-600">Fetching trace data…</div>
                    )}
                    {traceStatus === "error" && !traceEntries.length && (
                        <div className="border border-rose-400 bg-rose-50 px-4 py-4 text-xs text-rose-700">Unable to load traces for this session.</div>
                    )}
                    {traceStatus === "ready" && !traceEntries.length && (
                        <div className="border border-slate-200 bg-slate-100 px-4 py-4 text-xs text-slate-600">No function traces were captured for this session.</div>
                    )}
                    {traceStatus === "idle" && !traceEntries.length && (
                        <div className="border border-slate-200 bg-slate-100 px-4 py-4 text-xs text-slate-600">Traces will appear once data is collected for this session.</div>
                    )}
                    {traceEntries.length > 0 && (
                        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden">
                            {traceEntries.map((entry) => {
                                const isActive = selectedTrace?.id === entry.id;
                                const meta = entry.request || {};
                                const label = entry.label || meta.method || entry.id;
                                return (
                                    <div key={entry.id} className="border border-slate-200 bg-white">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedTraceId((prev) => (prev === entry.id ? null : entry.id));
                                                setViewMode("trace");
                                            }}
                                            className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition ${
                                                isActive ? "bg-slate-100" : "bg-white hover:bg-slate-50"
                                            }`}
                                        >
                                            <div className="min-w-0">
                                                <div className="break-words text-sm font-semibold text-slate-900">{label}</div>
                                                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.25em] text-slate-500">
                                                    <span>Status {meta.status ?? "—"}</span>
                                                    <span>{meta.durMs != null ? `${meta.durMs}ms` : "—"}</span>
                                                    <span>{entry.total} events</span>
                                                </div>
                                            </div>
                                            <span className="text-slate-400">{isActive ? "▾" : "▸"}</span>
                                        </button>
                                        {isActive && (
                                            <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
                                                <FunctionTraceViewer trace={selectedTrace?.events || []} title={traceTitle} className="is-embedded" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>
    );

    const traceFullView = (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-slate-200 bg-white">
            {tracePanelContent}
        </section>
    );

    return (
        <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-slate-100 text-slate-900">
            <header className="border-b border-slate-200 bg-white px-8 py-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <LogoMark className="h-10 w-10" />
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Replay console</p>
                            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Session debugger</h1>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em]">
                        <button
                            type="button"
                            onClick={() => setViewMode("replay")}
                            className={`border px-4 py-2 ${
                                viewMode === "replay"
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                            }`}
                        >
                            Replay
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("trace")}
                            className={`border px-4 py-2 ${
                                viewMode === "trace"
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                            }`}
                        >
                            Function traces
                        </button>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
                    <span className="font-mono text-slate-800">Session {sessionId || "—"}</span>
                    <span>{viewMode === "replay" ? timelineSummaryText : traceSummaryText}</span>
                </div>
            </header>
            <main className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
                {viewMode === "replay" ? (
                    <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                            {playbackSection}
                        </div>
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:w-[26rem] lg:flex-none lg:shrink-0 xl:w-[30rem]">
                            {timelinePanel}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
                        {traceFullView}
                    </div>
                )}
            </main>
        </div>
    );
}
