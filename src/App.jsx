// src/App.jsx
import React from "react";
import { Routes, Route, Link, Navigate, useSearchParams, useLocation } from "react-router-dom";
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
            <div style={{ padding: 24 }}>
                <h2>Replay</h2>
                <p>
                    Add <code>?sessionId=YOUR_SESSION_ID</code> to the URL, or use hash:&nbsp;
                    <code>#/s/YOUR_SESSION_ID</code>
                </p>
                <p>
                    Or jump to the{" "}
                    <Link to="/trace">Function Trace Viewer</Link>.
                </p>
            </div>
        );
    }
    return <SessionReplay sessionId={sid} />;
}

export default function App() {
    return (
        <div className="min-h-screen flex flex-col">
            {/* simple top nav */}
            <header className="flex items-center gap-4 p-3 border-b">
                <Link to="/" className="font-semibold">Session Replay</Link>
                <Link to="/trace" className="text-gray-600 hover:text-black">Function Trace</Link>
            </header>

            <main className="flex-1">
                <Routes>
                    {/* MAIN route: SessionReplay */}
                    <Route path="/" element={<SessionReplayRoute />} />

                    {/* Function Trace Viewer route */}
                    <Route path="/trace" element={<FunctionTracePage />} />

                    {/* Optional: redirect unknown paths to home */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </main>
        </div>
    );
}
