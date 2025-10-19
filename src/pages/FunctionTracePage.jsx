import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FunctionTraceViewer } from "../components/FunctionTracerViewer.jsx";
import useSessionTraces from "../hooks/useSessionTraces.js";

export default function FunctionTracePage() {
    const [search] = useSearchParams();
    const sessionId = search.get("sessionId") || "";
    const { status, entries } = useSessionTraces(sessionId);
    const [selectedId, setSelectedId] = useState(null);

    useEffect(() => {
        setSelectedId(null);
    }, [sessionId]);

    const traces = useMemo(() => entries, [entries]);
    const selected = useMemo(() => {
        if (!selectedId) return null;
        return traces.find((entry) => entry.id === selectedId) || null;
    }, [selectedId, traces]);

    useEffect(() => {
        if (selectedId && !traces.find((entry) => entry.id === selectedId)) {
            setSelectedId(null);
        }
    }, [selectedId, traces]);

    const title = selected
        ? `${selected.label || "Function trace"} (${selected.total || selected.events.length || 0} events)`
        : "Function trace";

    return (
        <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
            <header className="border-b border-slate-200 bg-white px-8 py-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Session traces</p>
                        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Function trace explorer</h1>
                    </div>
                    <div className="text-xs text-slate-600">Session {sessionId || "—"}</div>
                </div>
            </header>
            <main className="flex flex-1 min-h-0 flex-col gap-6 px-8 py-6">
                {!sessionId && (
                    <div className="border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
                        Provide a session id in the query string, e.g.
                        <code className="ml-2 bg-slate-200 px-2 py-1 text-xs text-slate-900">?sessionId=YOUR_SESSION_ID</code>
                        , to load trace data.
                    </div>
                )}

                {sessionId && status === "loading" && (
                    <div className="flex flex-1 items-center justify-center border border-slate-200 bg-white text-sm text-slate-600">
                        Fetching trace data…
                    </div>
                )}

                {sessionId && status === "error" && (
                    <div className="border border-rose-400 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                        Unable to load traces for this session. Please try again later.
                    </div>
                )}

                {sessionId && status === "ready" && traces.length === 0 && (
                    <div className="border border-slate-200 bg-slate-100 px-4 py-4 text-sm text-slate-600">
                        No function traces were captured for this session.
                    </div>
                )}

                {sessionId && status === "ready" && traces.length > 0 && (
                    <div className="flex min-h-0 flex-1 flex-col gap-4">
                        <p className="text-xs text-slate-500">Select a trace below to expand its captured events.</p>
                        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
                            {traces.map((entry) => {
                                const isActive = entry.id === selected?.id;
                                const meta = entry.request || {};
                                const label = entry.label || meta.method || entry.id;
                                return (
                                    <div key={entry.id} className="border border-slate-200 bg-white">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedId(entry.id)}
                                            className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition ${
                                                isActive ? "bg-slate-100" : "bg-white hover:bg-slate-50"
                                            }`}
                                        >
                                            <div>
                                                <div className="text-sm font-semibold text-slate-900">{label}</div>
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
                                                <FunctionTraceViewer trace={selected?.events || []} title={title} className="is-embedded" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
