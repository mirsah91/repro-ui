// src/App.jsx
import React from "react";
import { Routes, Route, Navigate, useSearchParams, useLocation } from "react-router-dom";
import SessionReplay from "./pages/SessionReplay";
import FunctionTracePage from "./pages/FunctionTracePage";

function useSessionIdFromUrl() {
    const [search] = useSearchParams();
    const { hash } = useLocation();

    // support ?sessionId=... and #/s/...
    const hashVal = (hash || "").replace(/^#\/?/, "");
    const m = hashVal.match(/^s\/(.+)$/);
    const sidFromHash = m ? m[1] : null;

    return sidFromHash || search.get("sessionId") || "";
}

function SessionReplayRoute() {
    const sid = useSessionIdFromUrl();
    if (!sid) {
        return (
            <div className="min-h-screen bg-slate-50 text-slate-900">
                <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
                    <div className="w-full max-w-lg space-y-6 rounded-3xl border border-slate-200 bg-white p-10 shadow-xl shadow-slate-200/60">
                        <div className="space-y-3 text-left">
                            <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Replay console</p>
                            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Load a session to get started</h1>
                            <p className="text-sm leading-6 text-slate-600 sm:text-base">
                                Append <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-900">?sessionId=YOUR_SESSION_ID</code> to the URL or use the hash form
                                <code className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-900">#/s/YOUR_SESSION_ID</code> to open a captured session replay.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5 text-left text-sm text-slate-600">
                            <p className="font-semibold text-slate-900">Why you&apos;ll like it</p>
                            <p className="mt-2 text-slate-600">
                                The viewer combines the rrweb recording, backend timeline, and any instrumented function traces so you can debug end-to-end without leaving the page.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    return <SessionReplay sessionId={sid} />;
}

export default function App() {
    return (
        <Routes>
            {/* MAIN route: SessionReplay */}
            <Route path="/" element={<SessionReplayRoute />} />

            {/* Function Trace Viewer route */}
            <Route path="/trace" element={<FunctionTracePage />} />

            {/* Optional: redirect unknown paths to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
