import React, { useEffect, useMemo, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/rrweb.min.css";
import useTimeline from "../hooks/useTimeline";
import { decodeBase64JsonArray } from "../lib/rrwebDecode";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const WINDOW_MS = 1500;   // ± window for "nearby" events
const POLL_MS = 200;

function useRrwebStream(sessionId) {
    const [meta, setMeta] = useState({ firstSeq: 0, lastSeq: 0 });
    const [status, setStatus] = useState("idle"); // idle | loading | ready | error

    const queueRef = useRef([]);
    const nextSeqRef = useRef(0);
    const doneRef = useRef(false);

    // load rrweb meta from /full
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

    // paginated pull
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

export default function SessionReplay({ sessionId }) {
    const containerRef = useRef(null);
    const replayerRef = useRef(null);

    const { meta, status, queueRef, pullMore, doneRef } = useRrwebStream(sessionId);
    const ticks = useTimeline(sessionId); // server-time ticks for backend layer

    const [currentTime, setCurrentTime] = useState(0); // rrweb virtual ms
    const [playerStatus, setPlayerStatus] = useState("idle"); // idle | loading | ready | no-rrweb | error
    const [showAll, setShowAll] = useState(false);

    // time alignment (server ms -> rrweb time)
    const rrwebFirstTsRef = useRef(null);
    const clockOffsetRef = useRef(0);

    const toRrwebTime = (serverMs) => serverMs - (clockOffsetRef.current || 0);

    // bootstrap player once rrweb meta is ready
    useEffect(() => {
        if (status !== "ready" || !containerRef.current || replayerRef.current) return;

        let cancelled = false;
        (async () => {
            try {
                setPlayerStatus("loading");

                // pull first page until we get >= 2 events (rrweb requirement)
                while (queueRef.current.length < 2 && !doneRef.current) {
                    await pullMore(10);
                }
                const initial = queueRef.current.splice(0, queueRef.current.length);
                if (!initial.length || initial.length < 2) {
                    setPlayerStatus("no-rrweb");
                    return;
                }

                // compute clock offset: align first rrweb event with earliest backend tick (if available)
                rrwebFirstTsRef.current = initial[0]?.timestamp || null;
                const firstTickTs = (ticks && ticks.length) ? (ticks[0]?.t ?? null) : null;
                clockOffsetRef.current =
                    rrwebFirstTsRef.current && firstTickTs
                        ? firstTickTs - rrwebFirstTsRef.current
                        : 0;

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

                // keep currentTime updated
                const interval = window.setInterval(() => {
                    try {
                        const t = replayerRef.current?.getCurrentTime?.() ?? 0;
                        setCurrentTime(t);
                    } catch {}
                }, POLL_MS);

                // background feed
                (async function feed() {
                    while (!cancelled && replayerRef.current && !doneRef.current) {
                        if (queueRef.current.length < 50) {
                            await pullMore(10);
                        }
                        const batch = queueRef.current.splice(0, 50);
                        if (batch.length) {
                            try { replayerRef.current.addEvent(batch); } catch {}
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
    }, [status, ticks]); // include `ticks` so offset adjusts when timeline arrives

    // combine & filter “nearby” backend events around rrweb time
    const nearby = useMemo(() => {
        if (!ticks?.length) return [];
        if (showAll) return ticks;

        const t = currentTime;
        return ticks.filter(ev => {
            const aligned = toRrwebTime(ev.t || 0);
            return Math.abs(aligned - t) <= WINDOW_MS;
        }).slice(0, 50);
    }, [ticks, currentTime, showAll]);

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

                {!ticks?.length && (
                    <div className="text-xs text-gray-500 mb-2">
                        no backend timeline data for this session.
                    </div>
                )}

                <ul className="space-y-2">
                    {nearby.map((e, i) => (
                        <li key={i} className="rounded border p-2">
                            <div className="text-xs text-gray-500">
                                {e.kind} @ {e.t} (aligned ~ {Math.round(toRrwebTime(e.t))}ms)
                            </div>

                            {e.kind === "request" && (
                                <div className="text-sm">
                                    <div className="font-mono break-all">{e.meta?.method} {e.meta?.url}</div>
                                    <div className="text-gray-600">status {e.meta?.status} • {e.meta?.durMs}ms</div>
                                </div>
                            )}

                            {e.kind === "db" && (
                                <div className="text-sm">
                                    <div className="font-mono">{e.meta?.collection} • {e.meta?.op}</div>
                                    {e.meta?.query && (
                                        <pre className="text-[11px] bg-black-50 rounded p-1 overflow-auto">
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
                                </div>
                            )}
                        </li>
                    ))}
                    {!nearby.length && (
                        <li className="text-xs text-gray-500">no events to show.</li>
                    )}
                </ul>
            </div>
        </div>
    );
}
