import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/rrweb.min.css";
import useTimeline from "../hooks/useTimeline";
import { decodeBase64JsonArray } from "../lib/rrwebDecode";
import EmailItem from "../components/EmailItem.jsx";
import SignalGraph from "../components/SignalGraph.jsx";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const WINDOW_MS = 1500;
const POLL_MS = 200;

// rank order inside one action group
const KIND_RANK = { action: 0, request: 1, db: 2, email: 3 };
const KIND_COLORS = {
    action: "#38bdf8",
    request: "#34d399",
    db: "#fbbf24",
    email: "#f472b6",
    default: "#cbd5f5",
};

function eventKeyFor(ev, fallback = 0) {
    if (!ev || typeof ev !== "object") {
        return `event-${fallback}`;
    }

    const parts = [ev.kind || "event", ev.actionId, ev.id, ev.meta?.id, ev.meta?.requestId, ev.meta?.emailId]
        .filter(Boolean)
        .map(String);

    if (parts.length) {
        return parts.join(":");
    }

    return `${ev.kind || "event"}-${fallback}`;
}

const iconStroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
};

function IconPlay(props) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...iconStroke} {...props}>
            <polygon points="7 4 20 12 7 20 7 4" fill="currentColor" stroke="none" />
        </svg>
    );
}

function IconPause(props) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...iconStroke} {...props}>
            <line x1="9" y1="4" x2="9" y2="20" />
            <line x1="15" y1="4" x2="15" y2="20" />
        </svg>
    );
}

function IconRestart(props) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...iconStroke} {...props}>
            <polyline points="3 2 3 8 9 8" />
            <path d="M3.46 10A9 9 0 1 0 6 5.3" />
        </svg>
    );
}

function IconChevronDown(props) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...iconStroke} {...props}>
            <polyline points="6 9 12 15 18 9" />
        </svg>
    );
}

function IconClock(props) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...iconStroke} {...props}>
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 15" />
        </svg>
    );
}

function IconSparkles(props) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...iconStroke} {...props}>
            <path d="M12 3.5 13.8 8.2 18.5 10 13.8 11.8 12 16.5 10.2 11.8 5.5 10 10.2 8.2 12 3.5z" stroke="none" fill="currentColor" />
            <path d="M5 4l.5 1.5L7 6l-1.5.5L5 8l-.5-1.5L3 6l1.5-.5z" stroke="none" fill="currentColor" opacity="0.7" />
            <path d="M18.5 15l.4 1.2 1.1.4-1.1.4-.4 1.2-.4-1.2-1.1-.4 1.1-.4z" stroke="none" fill="currentColor" opacity="0.7" />
        </svg>
    );
}

function IconGlobe(props) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...iconStroke} {...props}>
            <circle cx="12" cy="12" r="9" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <path d="M12 3c2.5 2.7 3.8 6 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-6-3.8-9s1.3-6.3 3.8-9z" />
        </svg>
    );
}

function IconDatabase(props) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...iconStroke} {...props}>
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
            <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
    );
}

function IconMail(props) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...iconStroke} {...props}>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <polyline points="3 7.5 12 13 21 7.5" />
        </svg>
    );
}

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
    const lastPausedTimeRef = useRef(0);

    const { status, queueRef, pullMore, doneRef } = useRrwebStream(sessionId);
    const rawTicks = useTimeline(sessionId); // backend events (server time)

    const [currentTime, setCurrentTime] = useState(0); // rrweb virtual ms
    const [playerStatus, setPlayerStatus] = useState("idle"); // idle | loading | ready | playing | paused | complete | no-rrweb | error
    const [showAll, setShowAll] = useState(false);
    const [hoveredMarker, setHoveredMarker] = useState(null);
    const [isGraphOpen, setIsGraphOpen] = useState(false);

    const trackRef = useRef(null);

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

            const key = eventKeyFor(ev, out.length);

            out.push({
                ...ev,
                _key: key,
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

    // groups to render (Action → Request → DB → Email)
    const renderGroups = React.useMemo(() => {
        return groupByAction(baseItems);
    }, [baseItems]);

    const timelineSequence = useMemo(() => flattenGrouped(renderGroups), [renderGroups]);

    const timelineAnchor = useMemo(() => {
        if (!ticks.length) return null;
        const first = ticks[0];
        if (typeof first?._startServer === "number") return first._startServer;
        if (typeof first?._t === "number") return first._t;
        return null;
    }, [ticks]);

    const formatRelativeTime = useCallback((ms) => {
        if (typeof ms !== "number" || timelineAnchor == null) return "—";
        const delta = ms - timelineAnchor;
        if (!Number.isFinite(delta)) return "—";
        const sign = delta >= 0 ? "+" : "-";
        const abs = Math.abs(delta);
        if (abs < 1000) return `${sign}${Math.round(abs)}ms`;
        if (abs < 60_000) {
            const seconds = abs / 1000;
            return `${sign}${seconds.toFixed(seconds >= 10 ? 0 : 2)}s`;
        }
        const minutes = abs / 60_000;
        return `${sign}${minutes.toFixed(minutes >= 10 ? 0 : 1)}m`;
    }, [timelineAnchor]);

    const formatActionWindow = useCallback((action) => {
        if (!action) return null;
        const start = typeof action.tStart === "number" ? formatRelativeTime(action.tStart) : null;
        const end = typeof action.tEnd === "number" ? formatRelativeTime(action.tEnd) : null;
        if (!start && !end) return null;
        if (start && end) return `${start} → ${end}`;
        return start ?? end;
    }, [formatRelativeTime]);

    function statusTone(status) {
        if (typeof status !== "number") return "text-slate-300";
        if (status >= 500) return "text-rose-300";
        if (status >= 400) return "text-amber-300";
        return "text-emerald-300";
    }

    const getKindPresentation = useCallback((kind) => {
        switch (kind) {
            case "action":
                return {
                    label: "User action",
                    Icon: IconSparkles,
                    accent: "border-sky-400/40 bg-sky-500/10 text-sky-200",
                };
            case "request":
                return {
                    label: "Network request",
                    Icon: IconGlobe,
                    accent: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
                };
            case "db":
                return {
                    label: "Database",
                    Icon: IconDatabase,
                    accent: "border-amber-400/40 bg-amber-500/10 text-amber-200",
                };
            case "email":
                return {
                    label: "Email",
                    Icon: IconMail,
                    accent: "border-pink-400/40 bg-pink-500/10 text-pink-200",
                };
            default:
                return {
                    label: kind,
                    Icon: IconClock,
                    accent: "border-slate-400/40 bg-slate-500/10 text-slate-200",
                };
        }
    }, []);

    // bootstrap player once rrweb meta is ready
    useEffect(() => {
        if (status !== "ready" || !containerRef.current || replayerRef.current) return;

        let cancelled = false;
        let intervalId = null;
        let feedCancelled = false;
        let removeFinishListener = null;

        setPlayerStatus("loading");

        (async () => {
            try {
                // ensure we have at least 2 events for rrweb init
                while (queueRef.current.length < 2 && !doneRef.current) {
                    await pullMore(10);
                }
                const initial = queueRef.current.splice(0, queueRef.current.length);
                if (!initial.length) {
                    setPlayerStatus("no-rrweb");
                    return;
                }

                rrwebZeroTsRef.current = initial[0]?.timestamp || null;

                if (initial.length < 2) {
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

                const finishHandler = () => {
                    if (cancelled) return;
                    const metaData = rep.getMetaData?.();
                    const total = metaData?.totalTime ?? 0;
                    setCurrentTime(total);
                    lastPausedTimeRef.current = 0;
                    setPlayerStatus("complete");
                };

                if (typeof rep.on === "function") {
                    const maybeUnsub = rep.on("finish", finishHandler);
                    if (typeof maybeUnsub === "function") {
                        removeFinishListener = maybeUnsub;
                    } else if (typeof rep.off === "function") {
                        removeFinishListener = () => rep.off("finish", finishHandler);
                    }
                }

                rep.play();

                // keep current time in sync
                intervalId = window.setInterval(() => {
                    if (cancelled) return;
                    try {
                        const t = replayerRef.current?.getCurrentTime?.() ?? 0;
                        setCurrentTime(t);
                    } catch {}
                }, POLL_MS);

                // background feed: add events one-by-one (safer)
                (async function feed() {
                    while (!cancelled && !feedCancelled && replayerRef.current && !doneRef.current) {
                        if (queueRef.current.length < 50) {
                            await pullMore(10);
                        }
                        const batch = queueRef.current.splice(0, 50);
                        for (const ev of batch) {
                            try { replayerRef.current.addEvent(ev); } catch {}
                        }
                        await new Promise((r) => setTimeout(r, 100));
                    }
                })();

                setPlayerStatus("playing");
            } catch (e) {
                console.error("replay bootstrap error", e);
                setPlayerStatus("error");
            }
        })();

        return () => {
            cancelled = true;
            feedCancelled = true;
            if (intervalId) {
                window.clearInterval(intervalId);
            }
            if (typeof removeFinishListener === "function") {
                try { removeFinishListener(); } catch {}
            }
            try { replayerRef.current?.pause(); } catch {}
            replayerRef.current = null;
        };
    }, [status, /* do NOT include ticks here to avoid re-init loop */]);

    // if ticks arrive after rrweb started, (re)compute offset without reinitializing player
    useEffect(() => {
        if (!rrwebFirstTsRef.current || !ticks.length) return;
        clockOffsetRef.current = ticks[0]._t - rrwebFirstTsRef.current;
    }, [ticks]);

    const serverToRrwebOffsetMs = useCallback((serverMs) => {
        if (typeof serverMs !== "number") return null;
        const rrFirst = rrwebFirstTsRef.current;
        const offset = clockOffsetRef.current ?? 0; // server - rrweb
        if (typeof rrFirst !== "number") return null;
        const virtual = serverMs - offset - rrFirst;
        return Number.isFinite(virtual) ? Math.max(0, virtual) : null;
    }, []);

    const meta = replayerRef.current?.getMetaData?.();
    const totalTime = meta?.totalTime ?? 0;
    const progress = totalTime > 0 ? Math.min(100, (currentTime / totalTime) * 100) : 0;
    const isPlaying = playerStatus === "playing";
    const canPause = isPlaying;
    const canPlay = ["ready", "paused", "idle", "complete"].includes(playerStatus);
    const PrimaryIcon = isPlaying ? IconPause : IconPlay;
    const primaryLabel = isPlaying ? "Pause" : "Play";
    const currentSeconds = currentTime / 1000;
    const totalSeconds = totalTime / 1000;
    const highlightLabel = absNow != null ? formatRelativeTime(absNow) : null;
    const hasHiddenEvents = !showAll && baseItems.length < ticks.length;
    const highlightCopy = showAll
        ? "Showing the complete sequence of backend signals captured during the replay."
        : highlightLabel && highlightLabel !== "—"
            ? `Highlighting events near ${highlightLabel} from the active replay position.`
            : hasHiddenEvents
                ? "Showing a focused slice around the active replay position."
                : "Highlighting events around the active replay position.";

    const eventMarkers = useMemo(() => {
        if (!totalTime || !Number.isFinite(totalTime)) return [];

        return ticks
            .map((ev, idx) => {
                const aligned =
                    typeof ev._alignedStart === "number"
                        ? ev._alignedStart
                        : typeof ev._alignedEnd === "number"
                            ? ev._alignedEnd
                            : serverToRrwebOffsetMs(
                                (typeof ev._startServer === "number" && ev._startServer) ??
                                (typeof ev._endServer === "number" && ev._endServer) ??
                                (typeof ev._t === "number" && ev._t) ??
                                null,
                            );

                if (aligned == null || !Number.isFinite(aligned)) return null;
                const percent = Math.max(0, Math.min(100, (aligned / totalTime) * 100));
                const key = ev._key || eventKeyFor(ev, idx);
                const { label, Icon } = getKindPresentation(ev.kind);
                const color = KIND_COLORS[ev.kind] ?? KIND_COLORS.default;

                return {
                    id: key,
                    percent,
                    event: ev,
                    label,
                    Icon,
                    color,
                    aligned,
                };
            })
            .filter(Boolean);
    }, [ticks, totalTime, serverToRrwebOffsetMs]);

    const signalGraphItems = useMemo(() => {
        if (!ticks.length) return [];

        return ticks.map((ev, idx) => {
            const presentation = getKindPresentation(ev.kind);
            const baseTime =
                (typeof ev._startServer === "number" && ev._startServer) ??
                (typeof ev._t === "number" && ev._t) ??
                (typeof ev._endServer === "number" && ev._endServer) ??
                null;

            let name = ev.label || presentation.label;
            let detail = null;
            const detailLines = [];
            const badges = [];
            if (ev.kind === "request") {
                const method = ev.meta?.method;
                const url = ev.meta?.url;
                name = ev.meta?.name || url || name;
                detail = [method, url].filter(Boolean).join(" · ");
                if (ev.meta?.status) badges.push(`Status ${ev.meta.status}`);
                if (ev.meta?.service) detailLines.push(ev.meta.service);
            } else if (ev.kind === "db") {
                const collection = ev.meta?.collection;
                const op = ev.meta?.op;
                name = collection ? `${collection}${op ? ` • ${op}` : ""}` : name;
                detail = [collection, op].filter(Boolean).join(" · ");
                if (op) badges.push(op);
                if (ev.meta?.resultMeta) {
                    detailLines.push(`Result ${JSON.stringify(ev.meta.resultMeta)}`);
                }
                if (ev.meta?.query) {
                    let query = "";
                    try {
                        query = typeof ev.meta.query === "string" ? ev.meta.query : JSON.stringify(ev.meta.query);
                    } catch (err) {
                        query = "[query]";
                    }
                    const preview = query.length > 140 ? `${query.slice(0, 137)}…` : query;
                    detailLines.push(preview);
                }
            } else if (ev.kind === "email") {
                const subject = ev.meta?.subject;
                const to = ev.meta?.to;
                name = subject || name;
                detail = to ? `To ${to}` : detail;
                if (ev.meta?.provider) detailLines.push(ev.meta.provider);
            } else if (ev.kind === "action") {
                const description = ev.meta?.description;
                name = description || name;
            }

            if (!detail && ev.actionId) {
                detail = `Action ${ev.actionId}`;
            }

            const duration = typeof ev?.meta?.durMs === "number" ? ev.meta.durMs : null;
            const windowLabel =
                ev.kind === "action" && typeof ev.tStart === "number" && typeof ev.tEnd === "number"
                    ? `${formatRelativeTime(ev.tStart)} → ${formatRelativeTime(ev.tEnd)}`
                    : null;
            if (windowLabel) badges.push(windowLabel);
            if (detail) {
                detailLines.unshift(detail);
            }

            return {
                id: ev._key || `${ev.kind}-${ev.actionId ?? ev.id ?? idx}`,
                event: ev,
                kind: ev.kind ?? "other",
                color: KIND_COLORS[ev.kind] ?? KIND_COLORS.default,
                title: presentation.label,
                name,
                detail: detailLines.length ? detailLines[0] : null,
                lines: detailLines,
                badges,
                relative: formatRelativeTime(baseTime ?? ev._startServer ?? ev._endServer ?? ev._t ?? null),
                durationLabel: duration ? `${Math.round(duration)}ms` : null,
                serverTime: baseTime,
                serverStart: typeof ev._startServer === "number" ? ev._startServer : null,
                serverEnd: typeof ev._endServer === "number" ? ev._endServer : null,
            };
        });
    }, [ticks, formatRelativeTime, getKindPresentation]);

    const hoveredEvent = hoveredMarker?.event;
    const hoveredPresentation = hoveredEvent ? getKindPresentation(hoveredEvent.kind) : null;
    const hoveredRelative = hoveredEvent
        ? formatRelativeTime(
            (typeof hoveredEvent._t === "number" && hoveredEvent._t) ??
            (typeof hoveredEvent._startServer === "number" && hoveredEvent._startServer) ??
            (typeof hoveredEvent._endServer === "number" && hoveredEvent._endServer) ??
            null,
        )
        : null;
    const hoveredRrwebLabel =
        hoveredMarker?.aligned != null && Number.isFinite(hoveredMarker?.aligned)
            ? `~${Math.round(hoveredMarker.aligned)}ms replay`
            : null;

    const tooltipAnchor = useMemo(() => {
        if (!hoveredMarker) return null;
        const percent = Number(hoveredMarker.percent);
        if (!Number.isFinite(percent)) return null;
        if (percent < 12) {
            return { left: Math.max(percent, 4), translate: "-10%" };
        }
        if (percent > 88) {
            return { left: Math.min(percent, 96), translate: "-90%" };
        }
        return { left: percent, translate: "-50%" };
    }, [hoveredMarker]);

    const statusChip = useMemo(() => {
        switch (playerStatus) {
            case "playing":
                return { label: "Playing", tone: "bg-emerald-400", text: "text-emerald-200", pulse: true };
            case "paused":
                return { label: "Paused", tone: "bg-amber-300", text: "text-amber-200", pulse: false };
            case "complete":
                return { label: "Complete", tone: "bg-sky-400", text: "text-sky-200", pulse: false };
            case "loading":
                return { label: "Loading", tone: "bg-blue-400", text: "text-blue-200", pulse: true };
            case "no-rrweb":
                return { label: "No replay", tone: "bg-slate-500", text: "text-slate-300", pulse: false };
            case "error":
                return { label: "Error", tone: "bg-rose-400", text: "text-rose-200", pulse: false };
            case "ready":
                return { label: "Ready", tone: "bg-sky-400", text: "text-sky-200", pulse: false };
            default:
                return { label: "Idle", tone: "bg-slate-500", text: "text-slate-300", pulse: false };
        }
    }, [playerStatus]);

    const playFromVirtualTime = useCallback((virtualMs) => {
        const rep = replayerRef.current;
        if (!rep) return;

        const limit = totalTime || 0;
        const clamped = Math.max(0, Math.min(limit, Number(virtualMs) || 0));

        try {
            rep.pause();
            lastPausedTimeRef.current = clamped;
            rep.play(clamped);
            setPlayerStatus("playing");
            setCurrentTime(clamped);
        } catch (e) {
            console.warn("seek failed", e);
        }
    }, [totalTime]);

    const seekFromClientX = useCallback((clientX) => {
        const track = trackRef.current;
        if (!track || !totalTime) return;

        const rect = track.getBoundingClientRect();
        if (!rect?.width) return;

        const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
        playFromVirtualTime(ratio * totalTime);
    }, [playFromVirtualTime, totalTime]);

    const handleTrackPointerDown = useCallback((event) => {
        event.preventDefault();
        setHoveredMarker(null);
        seekFromClientX(event.clientX);

        const onMove = (e) => seekFromClientX(e.clientX);
        const onUp = (e) => {
            seekFromClientX(e.clientX);
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
        };

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    }, [seekFromClientX]);

    const alignedSeekMsFor = useCallback((ev) => {
        if (!ev) return null;

        const serverMs =
            (typeof ev._startServer === "number" && ev._startServer) ??
            (typeof ev._endServer === "number" && ev._endServer) ??
            (typeof ev._t === "number" && ev._t) ??
            null;

        const rrMs = serverToRrwebOffsetMs(serverMs);
        if (rrMs == null) return null;

        const total = replayerRef.current?.getMetaData?.().totalTime ?? 0;
        return Math.max(0, Math.min(total || 0, rrMs));
    }, [serverToRrwebOffsetMs]);

    const jumpToEvent = useCallback((ev) => {
        const target = alignedSeekMsFor(ev);
        if (target == null) return;

        setHoveredMarker(null);
        playFromVirtualTime(target);
    }, [alignedSeekMsFor, playFromVirtualTime]);

    const handleGraphClose = useCallback(() => {
        setIsGraphOpen(false);
    }, []);

    const handleGraphNodeSelect = useCallback((ev) => {
        if (ev) {
            jumpToEvent(ev);
            setIsGraphOpen(false);
        }
    }, [jumpToEvent]);

    return (
        <div className="flex w-full flex-1 flex-col gap-12 px-6 pb-16 text-slate-100 sm:px-10 lg:px-16 xl:px-20 2xl:px-24">
            <section className="-mx-6 flex w-auto flex-col gap-6 sm:-mx-10 lg:-mx-16 xl:-mx-20 2xl:-mx-24">
                <div className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-[0_38px_120px_-72px_rgba(15,23,42,0.95)]">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_65%)]" aria-hidden />
                    <div ref={containerRef} className="relative z-10 h-[320px] w-full sm:h-[420px] lg:h-[560px]" />
                </div>

                <div className="rounded-3xl border border-white/10 bg-slate-950/80 px-6 py-5 shadow-[0_38px_120px_-72px_rgba(15,23,42,0.95)] backdrop-blur">
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={() => {
                                const rep = replayerRef.current;
                                if (!rep) return;

                                if (canPause) {
                                    const now = rep.getCurrentTime?.() ?? currentTime ?? 0;
                                    lastPausedTimeRef.current = now;
                                    rep.pause();
                                    setPlayerStatus("paused");
                                } else if (canPlay) {
                                    const resumeAt =
                                        Number.isFinite(lastPausedTimeRef.current) && lastPausedTimeRef.current >= 0
                                            ? lastPausedTimeRef.current
                                            : (rep.getCurrentTime?.() ?? currentTime ?? 0);
                                    rep.play(resumeAt);
                                    setPlayerStatus("playing");
                                }
                            }}
                            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-medium shadow-[0_16px_36px_-18px_rgba(15,23,42,0.95)] transition hover:border-white/40 hover:bg-white/10"
                        >
                            <PrimaryIcon className="h-4 w-4" />
                            {primaryLabel}
                        </button>
                        <button
                            onClick={() => {
                                const rep = replayerRef.current;
                                if (!rep) return;
                                rep.pause();
                                lastPausedTimeRef.current = 0;
                                rep.play(0);
                                setPlayerStatus("playing");
                                setCurrentTime(0);
                            }}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-2.5 text-sm text-slate-200 transition hover:border-white/30 hover:bg-white/10"
                        >
                            <IconRestart className="h-4 w-4" />
                            Restart
                        </button>
                        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.32em] text-white/60 sm:ml-auto">
                            <span
                                className={`h-2 w-2 rounded-full ${statusChip.tone} ${statusChip.pulse ? "animate-pulse" : ""}`}
                                aria-hidden
                            />
                            <span className={`font-semibold ${statusChip.text}`}>{statusChip.label}</span>
                        </div>
                    </div>

                    <div className="mt-6 space-y-6">
                        <div
                            ref={trackRef}
                            role="presentation"
                            onPointerDown={handleTrackPointerDown}
                            className="relative z-30 h-24 w-full cursor-pointer select-none overflow-visible rounded-3xl border border-white/10 bg-slate-950/80 px-6 py-5"
                        >
                            <div className="absolute left-6 right-6 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>

                            {eventMarkers.map((marker) => {
                                const relativeLabel = formatRelativeTime(
                                    (typeof marker.event._t === "number" && marker.event._t) ??
                                    (typeof marker.event._startServer === "number" && marker.event._startServer) ??
                                    (typeof marker.event._endServer === "number" && marker.event._endServer) ??
                                    null,
                                );
                                const isActive = marker.aligned != null && Math.abs(marker.aligned - currentTime) <= 250;
                                const boxShadow = isActive
                                    ? "0 0 0 2px rgba(15,23,42,0.95), 0 0 0 6px rgba(56,189,248,0.45)"
                                    : "0 0 0 2px rgba(15,23,42,0.9)";

                                return (
                                    <button
                                        key={marker.id}
                                        type="button"
                                        title={`${marker.label}${relativeLabel && relativeLabel !== "—" ? ` · ${relativeLabel}` : ""}`}
                                        aria-label={`${marker.label}${relativeLabel && relativeLabel !== "—" ? ` at ${relativeLabel}` : ""}`}
                                        className="absolute top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-slate-950 transition-transform duration-150 hover:-translate-y-[55%] hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                                        style={{
                                            left: `${marker.percent}%`,
                                            backgroundColor: marker.color,
                                            boxShadow,
                                            zIndex: 40,
                                        }}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            jumpToEvent(marker.event);
                                        }}
                                        onMouseEnter={() => setHoveredMarker(marker)}
                                        onMouseLeave={() => {
                                            setHoveredMarker((prev) => (prev?.id === marker.id ? null : prev));
                                        }}
                                        onFocus={() => setHoveredMarker(marker)}
                                        onBlur={() => {
                                            setHoveredMarker((prev) => (prev?.id === marker.id ? null : prev));
                                        }}
                                    >
                                        {marker.Icon && <marker.Icon className="h-4 w-4" />}
                                    </button>
                                );
                            })}

                            {hoveredMarker && hoveredPresentation && tooltipAnchor && (
                                <div
                                    className="pointer-events-none absolute top-full z-50 mt-3 w-64 max-w-[18rem] rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-[0_22px_48px_-26px_rgba(15,23,42,0.95)] backdrop-blur"
                                    style={{
                                        left: `${tooltipAnchor.left}%`,
                                        transform: `translateX(${tooltipAnchor.translate})`,
                                    }}
                                >
                                    <div className="flex items-start gap-3">
                                        <span
                                            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5"
                                            style={{ color: hoveredMarker.color, boxShadow: `0 18px 36px -24px ${hoveredMarker.color}AA` }}
                                        >
                                            <hoveredPresentation.Icon className="h-4 w-4" />
                                        </span>
                                        <div className="flex-1 space-y-2 text-sm text-white/80">
                                            <div className="text-xs uppercase tracking-[0.2em] text-white/50">{hoveredPresentation.label}</div>
                                            <div className="text-sm font-semibold text-white/90">
                                                {hoveredEvent?.label || hoveredEvent?.actionId || hoveredEvent?.meta?.url || hoveredEvent?.meta?.subject || "Timeline event"}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/60">
                                                {hoveredRelative && hoveredRelative !== "—" && <span>{hoveredRelative}</span>}
                                                {hoveredRrwebLabel && <span>{hoveredRrwebLabel}</span>}
                                            </div>

                                            {hoveredEvent?.kind === "request" && hoveredEvent?.meta?.method && (
                                                <div className="font-mono text-[11px] uppercase tracking-wider text-emerald-200">
                                                    {hoveredEvent.meta.method}
                                                    {hoveredEvent.meta.url && <span className="ml-2 text-white/60">{hoveredEvent.meta.url}</span>}
                                                </div>
                                            )}

                                            {hoveredEvent?.kind === "db" && hoveredEvent?.meta?.collection && (
                                                <div className="font-mono text-[11px] uppercase tracking-wider text-amber-200">
                                                    {hoveredEvent.meta.collection} • {hoveredEvent.meta.op}
                                                </div>
                                            )}

                                            {hoveredEvent?.kind === "email" && hoveredEvent?.meta?.to && (
                                                <div className="text-[11px] text-white/60">To {hoveredEvent.meta.to}</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between text-xs text-white/60">
                            <span>0s</span>
                            <span className="font-medium text-white/80">{currentSeconds.toFixed(currentSeconds >= 10 ? 0 : 1)}s</span>
                            <span>{totalSeconds > 0 ? totalSeconds.toFixed(totalSeconds >= 10 ? 0 : 1) : "0"}s</span>
                        </div>
                    </div>
                </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-slate-950/70 px-6 py-6 shadow-[0_38px_120px_-72px_rgba(15,23,42,0.95)] backdrop-blur">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-white/50">Session intelligence</div>
                        <h2 className="mt-1 text-2xl font-semibold text-white">Timeline of signals</h2>
                        <p className="mt-1 max-w-2xl text-sm text-white/60">{highlightCopy}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setShowAll((prev) => !prev)}
                            className={`relative inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                                showAll
                                    ? "border-sky-400/60 bg-sky-500/10 text-sky-200 shadow-[0_12px_30px_-18px_rgba(56,189,248,0.65)]"
                                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:bg-white/10"
                            }`}
                        >
                            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${showAll ? "bg-sky-300" : "bg-white/40"}`} aria-hidden />
                            {showAll ? "Showing all events" : "Show all events"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsGraphOpen(true)}
                            disabled={!signalGraphItems.length}
                            className={`inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-xs font-semibold text-white transition ${
                                signalGraphItems.length
                                    ? "bg-gradient-to-r from-sky-500/20 via-blue-500/20 to-indigo-500/20 hover:border-white/35 hover:from-sky-500/30 hover:via-blue-500/30 hover:to-indigo-500/30"
                                    : "cursor-not-allowed bg-white/5 text-white/40"
                            }`}
                        >
                            <IconSparkles className="h-3.5 w-3.5" />
                            View signal graph
                        </button>
                    </div>
                </header>

                <div className="mt-6 space-y-6">
                    {playerStatus === "no-rrweb" && (
                        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                            No rrweb events (or too few to initialize) were captured for this session.
                        </div>
                    )}

                    {!ticks.length && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
                            No backend timeline data has been recorded for this session yet.
                        </div>
                    )}

                    {timelineSequence.length > 0 && (
                        <div className="-mx-4 overflow-x-auto px-4">
                            <div className="flex min-w-full snap-x items-stretch gap-3 pb-2">
                                {timelineSequence.map((ev, idx) => {
                                    const key = ev._key || eventKeyFor(ev, idx);
                                    const { label, Icon, accent } = getKindPresentation(ev.kind);
                                    const name = ev.label || ev.meta?.name || label;
                                    const relative = formatRelativeTime(
                                        (typeof ev._t === "number" && ev._t) ??
                                        (typeof ev._startServer === "number" && ev._startServer) ??
                                        (typeof ev._endServer === "number" && ev._endServer) ??
                                        null,
                                    );
                                    const aligned = alignedSeekMsFor(ev);
                                    const percent =
                                        aligned != null && Number.isFinite(aligned) && totalTime > 0
                                            ? Math.max(0, Math.min(100, (aligned / totalTime) * 100))
                                            : null;

                                    const handleHover = () => {
                                        if (percent == null || !Number.isFinite(percent)) return;
                                        setHoveredMarker({
                                            id: key,
                                            percent,
                                            event: ev,
                                            color: KIND_COLORS[ev.kind] ?? KIND_COLORS.default,
                                            label,
                                            aligned,
                                            Icon,
                                        });
                                    };

                                    const handleLeave = () => {
                                        setHoveredMarker((prev) => (prev?.id === key ? null : prev));
                                    };

                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            className={`group flex min-w-[220px] snap-start items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm text-white transition ${accent}`}
                                            onClick={() => jumpToEvent(ev)}
                                            onMouseEnter={handleHover}
                                            onFocus={handleHover}
                                            onMouseLeave={handleLeave}
                                            onBlur={handleLeave}
                                        >
                                            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white">
                                                <Icon className="h-4 w-4" />
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-semibold text-white">{name}</div>
                                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-white/60">
                                                    <span>{label}</span>
                                                    {relative && relative !== "—" && (
                                                        <span className="tracking-normal text-white/50">{relative}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {renderGroups.length > 0 && (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {renderGroups.map((g, gi) => {
                                const action = g.items.find((it) => it.kind === "action");
                                const title = action?.label || action?.actionId || "Other events";
                                const windowLabel = formatActionWindow(action);

                                return (
                                    <div
                                        key={g.id || gi}
                                        className="flex flex-col rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-5 shadow-[0_32px_80px_-48px_rgba(15,23,42,1)]"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-xs uppercase tracking-[0.24em] text-white/50">Action group</div>
                                                <div className="mt-1 text-lg font-semibold text-white">{title}</div>
                                            </div>
                                            {windowLabel && (
                                                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/60">
                                                    <IconClock className="h-3.5 w-3.5" />
                                                    {windowLabel}
                                                </div>
                                            )}
                                        </div>

                                        <div className="mt-4 max-h-96 flex-1 space-y-3 overflow-y-auto pr-1">
                                            {g.items.map((e, i) => {
                                                const aligned = toRrwebTime(e._t);
                                                const { label, Icon, accent } = getKindPresentation(e.kind);
                                                const relative = formatRelativeTime(e._t ?? e._startServer ?? e._endServer);

                                                return (
                                                    <button
                                                        key={e._key || i}
                                                        type="button"
                                                        onClick={() => jumpToEvent(e)}
                                                        className="group flex w-full items-start gap-4 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 text-left shadow-[0_18px_40px_-24px_rgba(15,23,42,0.95)] transition duration-200 hover:-translate-y-0.5 hover:border-white/30 hover:bg-slate-900/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                                                    >
                                                        <span className={`mt-1 flex h-10 w-10 items-center justify-center rounded-full border ${accent}`}>
                                                            <Icon className="h-4 w-4" />
                                                        </span>
                                                        <div className="flex-1 space-y-2">
                                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.18em] text-white/50">
                                                                <span>{label}</span>
                                                                {relative !== "—" && (
                                                                    <span className="flex items-center gap-2 text-[11px] normal-case text-white/60">
                                                                        <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                                                                        {relative}
                                                                    </span>
                                                                )}
                                                                {typeof aligned === "number" && (
                                                                    <span className="text-[11px] normal-case text-white/40">
                                                                        ~{Math.round(aligned)}ms rrweb
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {e.kind === "request" && (
                                                                <div className="space-y-1 text-sm text-white/80">
                                                                    <div className="font-mono text-[12px] uppercase tracking-wider text-emerald-200">
                                                                        {e.meta?.method}
                                                                        <span className="ml-2 text-white/60">{e.meta?.url}</span>
                                                                    </div>
                                                                    <div className="flex flex-wrap items-center gap-3 text-[12px] text-white/60">
                                                                        <span className={statusTone(e.meta?.status)}>Status {e.meta?.status ?? "—"}</span>
                                                                        {typeof e.meta?.durMs === "number" && (
                                                                            <span>Duration {e.meta.durMs}ms</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {e.kind === "db" && (
                                                                <div className="space-y-2 text-sm text-white/80">
                                                                    <div className="font-mono text-xs uppercase tracking-wider text-amber-200">
                                                                        {e.meta?.collection} • {e.meta?.op}
                                                                    </div>
                                                                    {e.meta?.query && (
                                                                        <pre className="max-h-40 overflow-auto rounded-xl border border-white/5 bg-slate-900/80 p-3 text-[11px] leading-relaxed text-white/70">
                                                                            {JSON.stringify(e.meta.query, null, 2)}
                                                                        </pre>
                                                                    )}
                                                                    {e.meta?.resultMeta && (
                                                                        <div className="text-xs text-white/50">
                                                                            Result {JSON.stringify(e.meta.resultMeta)}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {e.kind === "action" && (
                                                                <div className="space-y-1 text-sm text-white/80">
                                                                    <div className="font-semibold text-white/90">{e.label || e.actionId}</div>
                                                                    {(typeof e.tStart === "number" || typeof e.tEnd === "number") && (
                                                                        <div className="text-xs text-white/50">[{formatRelativeTime(e.tStart)} → {formatRelativeTime(e.tEnd)}]</div>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {e.kind === "email" && (
                                                                <div className="text-sm text-white/80">
                                                                    <EmailItem meta={e.meta} />
                                                                </div>
                                                            )}

                                                            {!['request', 'db', 'action', 'email'].includes(e.kind) && (
                                                                <div className="text-sm text-white/80">
                                                                    <pre className="text-[11px] text-white/60">{JSON.stringify(e, null, 2)}</pre>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {!renderGroups.length && !showAll && (
                        <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-white/70">
                            No events near the current replay moment. You can
                            <button className="ml-1 underline" onClick={() => setShowAll(true)}>
                                show the entire stream
                            </button>
                            .
                        </div>
                    )}

                    {hasHiddenEvents && (
                        <button
                            type="button"
                            onClick={() => setShowAll(true)}
                            className="flex w-full items-center justify-center rounded-2xl border border-sky-400/50 bg-sky-500/10 px-4 py-3 text-sm font-semibold text-sky-200 shadow-[0_18px_40px_-30px_rgba(56,189,248,0.8)] transition hover:border-sky-300 hover:bg-sky-500/20"
                        >
                            Show all {ticks.length} events
                        </button>
                    )}
                </div>
            </section>

            {isGraphOpen && (
                <SignalGraph
                    events={signalGraphItems}
                    onClose={handleGraphClose}
                    onNodeSelect={handleGraphNodeSelect}
                />
            )}
        </div>
    );
}
