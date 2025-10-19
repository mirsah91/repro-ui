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
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 pb-16 pt-12 sm:px-10">
                <header className="flex flex-col gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">Session traces</p>
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Function trace explorer</h1>
                    <p className="text-sm text-slate-600">Session ID: {sessionId || "—"}</p>
                </header>

                {!sessionId && (
                    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm">
                        Provide a session id in the query string, e.g. <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-900">?sessionId=YOUR_SESSION_ID</code>, to load trace data.
                    </div>
                )}

                {sessionId && status === "loading" && (
                    <div className="flex flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
                        <div className="animate-pulse text-sm text-slate-500">Fetching trace data…</div>
                    </div>
                )}

                {sessionId && status === "error" && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-5 text-sm text-rose-600">
                        Unable to load traces for this session. Please try again later.
                    </div>
                )}

                {sessionId && status === "ready" && traces.length === 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5 text-sm text-slate-600">
                        No function traces were captured for this session.
                    </div>
                )}

                {sessionId && status === "ready" && traces.length > 0 && (
                    <div className="flex flex-1 flex-col gap-4 pb-8">
                        <p className="text-xs text-slate-500">Select a trace below to expand its captured events.</p>
                        {traces.map((entry) => {
                            const isActive = entry.id === selected?.id;
                            const meta = entry.request || {};
                            const label = entry.label || meta.method || entry.id;
                            return (
                                <div key={entry.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedId(entry.id)}
                                        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-white"
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
                                        <div className="border-t border-slate-200 bg-slate-50 px-2 py-4 sm:px-4">
                                            <FunctionTraceViewer trace={selected?.events || []} title={title} className="is-embedded" />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
