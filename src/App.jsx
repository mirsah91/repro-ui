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
    const { pathname } = useLocation();
    const navItems = [
        { to: "/", label: "Replay" },
        { to: "/trace", label: "Trace Viewer" },
    ];

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            <div className="relative mx-auto flex min-h-screen w-full max-w-[1400px] flex-col overflow-hidden border-x border-white/5 bg-slate-950/80 shadow-[0_40px_160px_-90px_rgba(15,23,42,1)]">
                <header className="relative z-30 border-b border-slate-800/70 bg-slate-950/80 px-6 py-4 shadow-[0_12px_42px_-36px_rgba(15,23,42,1)] backdrop-blur">
                    <div className="flex items-center justify-between gap-6">
                        <Link to="/" className="group inline-flex items-center gap-4">
                            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-500 text-lg font-black text-slate-950 shadow-lg shadow-sky-500/40 transition group-hover:scale-105">
                                R
                            </span>
                            <div className="leading-tight">
                                <div className="text-[11px] uppercase tracking-[0.4em] text-slate-400">Repro toolkit</div>
                                <div className="text-lg font-semibold text-white">Session Intelligence</div>
                            </div>
                        </Link>
                        <nav className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-1.5 py-1.5 backdrop-blur">
                            {navItems.map((item) => {
                                const isActive = pathname === item.to;
                                return (
                                    <Link
                                        key={item.to}
                                        to={item.to}
                                        className={`relative inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                                            isActive
                                                ? "bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 text-white shadow-[0_18px_40px_-24px_rgba(56,189,248,0.65)]"
                                                : "text-slate-400 hover:text-white"
                                        }`}
                                    >
                                        {isActive && <span className="h-2 w-2 rounded-full bg-white/80" aria-hidden />}
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>
                </header>

                <main className="flex-1 min-h-0">
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
        </div>
    );
}
