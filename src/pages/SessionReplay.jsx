import React, { useEffect, useMemo, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/rrweb.min.css";
import { decodeBase64JsonArray } from "../lib/rrwebDecode.js";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

function useRrwebStream(sessionId) {
    const [meta, setMeta] = useState({ firstSeq: 0, lastSeq: 0 });
    const [status, setStatus] = useState("idle");

    // queue of pending events to add
    const queueRef = useRef([]);
    const nextSeqRef = useRef(0);
    const doneRef = useRef(false);

    // fetch rrweb meta (optional; if you already have /full you can reuse)
    useEffect(() => {
        let mounted = true;
        (async () => {
            setStatus("loading");
            try {
                const r = await fetch(`${API_BASE}/v1/sessions/${sessionId}/full?includeRrweb=1`, { credentials: "include" });
                const j = await r.json();
                const m = j?.rrweb || { firstSeq: 0, lastSeq: 0 };
                if (!mounted) return;
                setMeta(m);
                nextSeqRef.current = Math.max(0, Number(m.firstSeq || 0));
                setStatus("ready");
            } catch {
                setStatus("error");
            }
        })();
        return () => { mounted = false; };
    }, [sessionId]);

    // pull chunks in pages and enqueue events
    async function pullMore() {
        if (doneRef.current) return;
        const afterSeq = nextSeqRef.current - 1; // endpoint expects > afterSeq
        const r = await fetch(`${API_BASE}/v1/sessions/${sessionId}/rrweb?afterSeq=${afterSeq}&limit=5`);
        const j = await r.json();
        const items = j?.items || [];
        if (!items.length) { doneRef.current = true; return; }

        for (const it of items) {
            const events = decodeBase64JsonArray(it.base64);
            queueRef.current.push(...events);
            nextSeqRef.current = Math.max(nextSeqRef.current, Number(it.seq) + 1);
        }
    }

    return { meta, status, queueRef, pullMore, doneRef };
}

function useTimeline(sessionId) {
    const [ticks, setTicks] = useState([]);
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const r = await fetch(`${API_BASE}/v1/sessions/${sessionId}/timeline`);
                const j = await r.json();
                if (mounted) setTicks(j?.ticks || []);
            } catch {
                if (mounted) setTicks([]);
            }
        })();
        return () => { mounted = false; };
    }, [sessionId]);
    return ticks;
}

export default function SessionReplay({ sessionId }) {
    const containerRef = useRef(null);
    const replayerRef = useRef(null);
    const { meta, status, queueRef, pullMore, doneRef } = useRrwebStream(sessionId);
    const ticks = useTimeline(sessionId);

    const [currentTime, setCurrentTime] = useState(0); // ms (rrweb virtual)

    // boot a player with the first batch
    useEffect(() => {
        if (status !== "ready" || replayerRef.current || !containerRef.current) return;

        (async () => {
            // first page
            await pullMore();
            const initial = queueRef.current.splice(0, queueRef.current.length);
            if (!initial.length) return;

            const replayer = new Replayer(initial, {
                root: containerRef.current,
                liveMode: false,
                UNSAFE_replayCanvas: true,
                speed: 1.0,
                mouseTail: false,
            });

            // Time sync: capture time updates so we can show nearby backend events
            replayer.on("pause", () => {
                const t = replayer.getCurrentTime();
                setCurrentTime(t);
            });
            replayer.on("finish", () => {
                setCurrentTime(replayer.getCurrentTime());
            });
            replayer.on("state-change", (st) => {
                // 2 == playing, capture periodic time via requestAnimationFrame
                if (st === 2) {
                    const raf = () => {
                        if (!replayerRef.current) return;
                        setCurrentTime(replayerRef.current.getCurrentTime());
                        requestAnimationFrame(raf);
                    };
                    requestAnimationFrame(raf);
                }
            });

            replayerRef.current = replayer;
            replayer.play();

            // background feeder: pull & feed while playing
            (async function feed() {
                while (replayerRef.current && !doneRef.current) {
                    // if queue low, pull more
                    if (queueRef.current.length < 50) {
                        await pullMore();
                    }
                    // feed a chunk of events
                    const batch = queueRef.current.splice(0, 50);
                    for (const ev of batch) {
                        try { replayerRef.current.addEvent(ev); } catch {}
                    }
                    await new Promise(r => setTimeout(r, 100)); // small yield
                }
            })();
        })();

        return () => {
            try { replayerRef.current?.pause(); } catch {}
            replayerRef.current = null;
        };
    }, [status]);

    // pick “nearby” ticks to display (±1500ms window)
    const nearby = useMemo(() => {
        const t = currentTime;
        const WIN = 1500;
        return ticks.filter(x => {
            const xT = x.t ?? x.tStart ?? 0;
            return Math.abs(xT - t) <= WIN;
        }).slice(0, 20);
    }, [ticks, currentTime]);

    return (
        <div className="flex h-screen">
            <div className="flex-1 flex flex-col">
                <div ref={containerRef} className="flex-1 bg-gray-50 border-b" />
                <div className="p-2 border-t text-sm text-gray-600">
                    time: {Math.round(currentTime)} ms
                    <span className="ml-4">seq range: {meta.firstSeq} → {meta.lastSeq}</span>
                    <span className="ml-4">status: {status}</span>
                </div>
            </div>

            <div className="w-96 border-l p-3 overflow-auto">
                <div className="font-semibold mb-2">backend events near {Math.round(currentTime)}ms</div>
                <ul className="space-y-2">
                    {nearby.map((e, i) => (
                        <li key={i} className="rounded border p-2">
                            <div className="text-xs text-gray-500">{e.kind} @ {(e.t ?? e.tStart) || 0}</div>
                            {e.kind === 'request' && (
                                <div className="text-sm">
                                    <div className="font-mono">{e.meta?.method} {e.meta?.url}</div>
                                    <div className="text-gray-600">status {e.meta?.status} • {e.meta?.durMs}ms</div>
                                </div>
                            )}
                            {e.kind === 'db' && (
                                <div className="text-sm">
                                    <div className="font-mono">{e.meta?.collection} • {e.meta?.op}</div>
                                    {e.meta?.query && (
                                        <pre className="text-[11px] bg-gray-50 rounded p-1 overflow-auto">
{JSON.stringify(e.meta.query, null, 2)}
                    </pre>
                                    )}
                                    {e.meta?.resultMeta && (
                                        <div className="text-gray-600 text-xs">result {JSON.stringify(e.meta.resultMeta)}</div>
                                    )}
                                </div>
                            )}
                            {e.kind === 'email' && (
                                <div className="text-sm">
                                    <div className="font-mono">{e.meta?.subject}</div>
                                    <div className="text-gray-600 text-xs">
                                        to: {(e.meta?.to || []).map(a => a?.email || a).join(", ")} • {e.meta?.statusCode ?? '—'}
                                    </div>
                                </div>
                            )}
                            {e.kind === 'action' && (
                                <div className="text-sm">
                                    <div className="font-mono">{e.label || e.actionId}</div>
                                    <div className="text-gray-600 text-xs">[{e.tStart} … {e.tEnd}]</div>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
