import React, { useEffect, useMemo, useRef, useState } from "react";
import { Replayer } from "rrweb";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const WINDOW_MS = 1500;
const POLL_MS = 200;

export default function ReplayPage({ sessionId }) {
    const [data, setData] = useState(null);
    const [status, setStatus] = useState("loading"); // loading | ready | no-rrweb | error
    const [showAll, setShowAll] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [meta, setMeta] = useState({ firstSeq: null, lastSeq: null });

    const containerRef = useRef(null);
    const replayerRef = useRef(null);
    const clockOffsetRef = useRef(0);
    const rrwebFirstTsRef = useRef(null);
    const pollTimerRef = useRef(null);

    const decodeBase64Json = (b64) => {
        if (!b64) return [];
        const str = atob(b64);
        const bytes = new Uint8Array([...str].map((c) => c.charCodeAt(0)));
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        try { return JSON.parse(text); } catch { return []; }
    };

    const fetchFull = async (sid) => {
        const r = await fetch(`${API_BASE}/v1/sessions/${sid}/full?includeRrweb=1`);
        if (!r.ok) throw new Error(`full ${r.status}`);
        return await r.json();
    };

    const fetchChunk = async (sid, seq) => {
        const r = await fetch(`${API_BASE}/v1/sessions/${sid}/rrweb/chunk?seq=${seq}`);
        if (!r.ok) return []; // treat missing as empty, don’t hard fail
        const j = await r.json();
        const events = decodeBase64Json(j.base64 || j.dataBase64 || "");
        return Array.isArray(events) ? events : [];
    };

    const flattenRequests = (actions) => {
        const out = [];
        for (const a of actions || []) {
            for (const r of a.requests || []) {
                out.push({ kind: "request", t: r.t, meta: { method: r.method, url: r.url, status: r.status, durMs: r.durMs } });
            }
        }
        return out;
    };
    const flattenDb = (actions) => {
        const out = [];
        for (const a of actions || []) {
            for (const d of a.db || []) {
                out.push({ kind: "db", t: d.t, meta: { collection: d.collection, op: d.op, query: d.query, resultMeta: d.resultMeta } });
            }
        }
        return out;
    };
    const flattenEmails = (actions) => {
        const out = [];
        for (const a of actions || []) {
            for (const m of a.emails || []) {
                out.push({ kind: "email", t: m.t, meta: { subject: m.subject, to: m.to, statusCode: m.statusCode } });
            }
        }
        return out;
    };
    const flattenActions = (actions) => (actions || []).map((a) => ({
        kind: "action", tStart: a.tStart, tEnd: a.tEnd, actionId: a.actionId, label: a.label,
    }));

    const computeClockOffset = (rrwebFirstTs, actions, requests) => {
        rrwebFirstTsRef.current = rrwebFirstTs || 0;
        const cand = [];
        if (actions?.length) cand.push(actions[0].tStart || actions[0].t || null);
        if (requests?.length) cand.push(requests[0].t || null);
        const firstServerTs = cand.filter((x) => typeof x === "number").sort((a, b) => a - b)[0] || null;
        clockOffsetRef.current = rrwebFirstTs && firstServerTs ? firstServerTs - rrwebFirstTs : 0;
    };
    const toRrwebTime = (serverMs) => serverMs - (clockOffsetRef.current || 0);

    const allBackend = useMemo(() => {
        if (!data) return [];
        const reqs = flattenRequests(data.actions);
        const db   = flattenDb(data.actions);
        const mails= flattenEmails(data.actions);
        const acts = flattenActions(data.actions);
        const items = [...reqs, ...db, ...mails, ...acts.map(a => ({ ...a, t: a.tStart }))];
        return items.sort((a,b) => (a.t ?? a.tStart ?? 0) - (b.t ?? b.tStart ?? 0));
    }, [data]);

    const nearby = useMemo(() => {
        if (showAll) return allBackend;
        return allBackend.filter((e) => {
            const t = e.t ?? e.tStart ?? e.tEnd;
            if (!t) return false;
            const aligned = toRrwebTime(t);
            return Math.abs(aligned - currentTime) <= WINDOW_MS;
        });
    }, [allBackend, currentTime, showAll]);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                setStatus("loading");

                // 1) /full
                const full = await fetchFull(sessionId);
                if (cancelled) return;
                setData(full);

                const firstSeq = full?.rrweb?.firstSeq;
                const lastSeq  = full?.rrweb?.lastSeq;
                setMeta({ firstSeq: firstSeq ?? "—", lastSeq: lastSeq ?? "—" });

                // No rrweb at all?
                if (firstSeq == null || lastSeq == null || firstSeq > lastSeq) {
                    setStatus("no-rrweb");
                    return;
                }

                // 2) accumulate initial events until we have >= 2
                let bootstrapEvents = [];
                let seqCursor = firstSeq;

                while (seqCursor <= lastSeq && bootstrapEvents.length < 2) {
                    const evs = await fetchChunk(sessionId, seqCursor);
                    if (cancelled) return;
                    if (Array.isArray(evs) && evs.length) bootstrapEvents = bootstrapEvents.concat(evs);
                    seqCursor++;
                }

                if (bootstrapEvents.length < 2) {
                    // still not enough to init rrweb
                    setStatus("no-rrweb");
                    return;
                }

                const rrwebFirstTs = bootstrapEvents[0]?.timestamp || null;
                const flatReqs = flattenRequests(full.actions);
                computeClockOffset(rrwebFirstTs, full.actions, flatReqs);

                // 3) init player
                if (replayerRef.current) {
                    try { replayerRef.current.pause(); } catch {}
                }
                const rep = new Replayer(bootstrapEvents, {
                    root: containerRef.current,
                    UNSAFE_replayCanvas: true,
                });
                replayerRef.current = rep;
                rep.play();

                // 4) append remaining chunks (start from where we left off)
                for (let seq = seqCursor; seq <= lastSeq; seq++) {
                    const evs = await fetchChunk(sessionId, seq);
                    if (cancelled) return;
                    if (Array.isArray(evs) && evs.length) rep.addEvent(evs);
                }

                // 5) poll current time
                if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
                pollTimerRef.current = window.setInterval(() => {
                    try {
                        const t = replayerRef.current?.getCurrentTime?.() ?? 0;
                        setCurrentTime(t);
                    } catch {}
                }, POLL_MS);

                setStatus("ready");
            } catch (e) {
                console.error("replay load error", e);
                setStatus("error");
            }
        })();

        return () => {
            cancelled = true;
            if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
        };
    }, [sessionId]);

    return (
        <div className="flex h-screen">
            {/* left: player */}
            <div className="flex-1 flex flex-col">
                <div ref={containerRef} className="flex-1 bg-gray-50 border-b" />
                <div className="p-2 border-t text-sm text-gray-600">
                    time: {Math.round(currentTime)} ms
                    <span className="ml-4">seq range: {meta.firstSeq} → {meta.lastSeq}</span>
                    <span className="ml-4">status: {status}</span>
                </div>
            </div>

            {/* right: sidebar */}
            <div className="w-[28rem] min-w-[22rem] max-w-[32rem] border-l p-3 overflow-auto">
                <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">
                        backend events {showAll ? "(all)" : `near ${Math.round(currentTime)}ms`}
                    </div>
                    <label className="text-xs flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={showAll}
                            onChange={(e) => setShowAll(e.target.checked)}
                        />
                        show all
                    </label>
                </div>

                {status === "no-rrweb" && (
                    <div className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-2 mb-3">
                        no rrweb events available for this session (or too few to initialize).
                    </div>
                )}

                <ul className="space-y-2">
                    {nearby.map((e, i) => (
                        <li key={i} className="rounded border p-2">
                            <div className="text-xs text-gray-500">
                                {e.kind} @ {(e.t ?? e.tStart) || 0} (aligned ~ {Math.round(toRrwebTime(e.t ?? e.tStart ?? 0))}ms)
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
                                    <div className="font-mono">{e.meta?.collection} • {e.meta?.op}</div>
                                    {e.meta?.query && (
                                        <pre className="text-[11px] bg-gray-50 rounded p-1 overflow-auto">
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
                                        to: {(e.meta?.to || []).map((a) => a?.email || a).join(", ")} • {e.meta?.statusCode ?? "—"}
                                    </div>
                                </div>
                            )}

                            {e.kind === "action" && (
                                <div className="text-sm">
                                    <div className="font-mono break-all">{e.label || e.actionId}</div>
                                    <div className="text-gray-600 text-xs">
                                        [{e.tStart} … {e.tEnd}]
                                    </div>
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
