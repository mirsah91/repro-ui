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
            <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
                <header className="border-b border-slate-200 bg-white px-8 py-5">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Replay console</p>
                        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Load a session to get started</h1>
                    </div>
                </header>
                <main className="flex flex-1 items-center justify-center px-8 py-16">
                    <div className="w-full max-w-xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600">
                        <p>
                            Append <code className="bg-slate-200 px-2 py-1 text-xs text-slate-900">?sessionId=YOUR_SESSION_ID</code> to the URL or use
                            <code className="ml-2 bg-slate-200 px-2 py-1 text-xs text-slate-900">#/s/YOUR_SESSION_ID</code> to open a captured session replay.
                        </p>
                        <p className="mt-4">
                            The viewer combines the rrweb recording, backend timeline, and any instrumented function traces so you can debug end-to-end without leaving the page.
                        </p>
                    </div>
                </main>
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
