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
            <div className="min-h-screen bg-slate-950 text-slate-100">
                <div className="relative h-full overflow-hidden">
                    <div className="pointer-events-none absolute inset-0">
                        <div className="absolute -top-28 -left-28 h-72 w-72 rounded-full bg-sky-500/20 blur-3xl" />
                        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-fuchsia-500/10 blur-3xl" />
                    </div>
                    <div className="relative flex h-full flex-col items-center justify-center px-8 py-16 text-center">
                        <div className="max-w-xl space-y-6">
                            <div className="space-y-2">
                                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Replay console</h1>
                                <p className="text-sm text-slate-400 sm:text-base">
                                    Add <code className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-200">?sessionId=YOUR_SESSION_ID</code> to the URL
                                    or use the hash form <code className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-200">#/s/YOUR_SESSION_ID</code> to load a session.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-slate-800/60 bg-slate-900/70 px-6 py-5 text-left text-sm text-slate-300 shadow-xl backdrop-blur">
                                <p className="font-semibold text-slate-200">Tip</p>
                                <p className="mt-2 text-slate-400">
                                    Once a session loads you&apos;ll be able to inspect the replay, backend timeline, and the captured function trace all in one place.
                                </p>
                            </div>
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
