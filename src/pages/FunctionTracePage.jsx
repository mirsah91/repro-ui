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
        if (!selectedId && traces.length) return traces[0];
        return traces.find((entry) => entry.id === selectedId) || null;
    }, [selectedId, traces]);

    useEffect(() => {
        if (!selectedId && traces.length) {
            setSelectedId(traces[0].id);
        }
    }, [selectedId, traces]);

    const title = selected
        ? `${selected.label || "Function trace"} (${selected.total || selected.events.length || 0} events)`
        : "Function trace";

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100">
            <div className="relative min-h-screen overflow-hidden">
                <div className="pointer-events-none absolute inset-0">
                    <div className="absolute -left-28 top-[-6%] h-80 w-80 rounded-full bg-sky-400/30 blur-3xl" />
                    <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-fuchsia-400/20 blur-[140px]" />
                </div>
                <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 pb-16 pt-12 sm:px-10">
                    <header className="flex flex-col gap-2">
                        <p className="text-xs uppercase tracking-[0.4em] text-slate-300">Session traces</p>
                        <h1 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">Function trace explorer</h1>
                        <p className="text-sm text-slate-300">Session ID: {sessionId || "—"}</p>
                    </header>

                    {!sessionId && (
                        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 px-6 py-5 text-sm text-slate-200 shadow-xl backdrop-blur">
                            Provide a session id in the query string, e.g. <code className="rounded bg-slate-800 px-1 py-0.5">?sessionId=YOUR_SESSION_ID</code>, to load trace data.
                        </div>
                    )}

                    {sessionId && status === "loading" && (
                        <div className="flex flex-1 items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900/55">
                            <div className="animate-pulse text-sm text-slate-300">Fetching trace data…</div>
                        </div>
                    )}

                    {sessionId && status === "error" && (
                        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/15 px-6 py-5 text-sm text-rose-100">
                            Unable to load traces for this session. Please try again later.
                        </div>
                    )}

                    {sessionId && status === "ready" && traces.length === 0 && (
                        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 px-6 py-5 text-sm text-slate-200">
                            No function traces were captured for this session.
                        </div>
                    )}

                    {sessionId && status === "ready" && traces.length > 0 && (
                        <div className="grid flex-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
                            <aside className="flex flex-col gap-3 rounded-2xl border border-slate-800/60 bg-slate-900/70 p-5 backdrop-blur">
                                <p className="text-xs uppercase tracking-[0.3em] text-slate-300">Requests</p>
                                <div className="space-y-3 overflow-y-auto pr-1">
                                    {traces.map((entry) => {
                                        const isActive = entry.id === (selected?.id || selectedId);
                                        const meta = entry.request || {};
                                        return (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => setSelectedId(entry.id)}
                                                className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                                                    isActive
                                                        ? "border-sky-500/60 bg-sky-500/10 text-slate-100"
                                                        : "border-slate-700/60 bg-slate-900/45 text-slate-200 hover:border-slate-600 hover:bg-slate-900/65"
                                                }`}
                                            >
                                                <div className="font-mono text-xs text-slate-300">{entry.label}</div>
                                                <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                                                    <span>Status {meta.status ?? "—"}</span>
                                                    <span>{meta.durMs != null ? `${meta.durMs}ms` : "—"}</span>
                                                </div>
                                                <div className="mt-1 text-[11px] uppercase tracking-[0.25em] text-slate-300">
                                                    {entry.total} events
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </aside>

                            <div className="flex min-h-0 flex-col rounded-2xl border border-slate-800/60 bg-slate-900/75 p-5 backdrop-blur">
                                <FunctionTraceViewer trace={selected?.events || []} title={title} className="is-embedded" />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
