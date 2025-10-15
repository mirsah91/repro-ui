import React, { useMemo, useState } from "react";

const KIND_COLORS = {
    action: "bg-sky-500",
    request: "bg-emerald-500",
    db: "bg-violet-500",
    email: "bg-amber-500",
};

const KIND_LABELS = {
    action: "Action",
    request: "Request",
    db: "Database",
    email: "Email",
};

function formatMs(ms) {
    if (!Number.isFinite(ms)) return "—";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec.toFixed(0)}s`;
}

export default function PlayerTimeline({
    currentTime,
    totalTime,
    markers,
    onSeek,
    onMarkerSelect,
}) {
    const [hovered, setHovered] = useState(null);

    const normalizedMarkers = useMemo(() => {
        if (!totalTime || !Number.isFinite(totalTime)) return [];
        return markers
            .filter((m) => Number.isFinite(m.position) && m.position >= 0 && m.position <= totalTime)
            .map((m, idx) => ({
                ...m,
                key: m.id || `${m.kind}-${idx}`,
                pct: Math.min(100, Math.max(0, (m.position / totalTime) * 100)),
            }));
    }, [markers, totalTime]);

    const handleSeek = (value) => {
        if (!Number.isFinite(value)) return;
        onSeek?.(value);
    };

    const hoverDetail = hovered && (
        <div className="absolute -top-20 left-0 right-0 px-4">
            <div className="mx-auto max-w-sm rounded-lg bg-slate-900/90 text-slate-100 shadow-lg border border-slate-700/80 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{hovered.label || KIND_LABELS[hovered.kind] || hovered.kind}</span>
                    <span className="text-slate-400">{formatMs(hovered.position)}</span>
                </div>
                {hovered.meta && (
                    <div className="mt-2 space-y-1">
                        {hovered.meta.method && (
                            <div className="font-mono text-[11px] text-slate-200 break-words">{hovered.meta.method} {hovered.meta.url}</div>
                        )}
                        {hovered.meta.collection && (
                            <div className="font-mono text-[11px] text-slate-200 break-words">
                                {hovered.meta.collection} • {hovered.meta.op}
                            </div>
                        )}
                        {hovered.meta.status && (
                            <div className="text-slate-400">status {hovered.meta.status}</div>
                        )}
                        {hovered.meta.durMs && (
                            <div className="text-slate-400">duration {formatMs(hovered.meta.durMs)}</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="relative w-full select-none">
            {hoverDetail}
            <div className="flex items-center gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Timeline
                </div>
                <div className="ml-auto text-[11px] font-mono text-slate-500">
                    {formatMs(currentTime)} / {formatMs(totalTime)}
                </div>
            </div>
            <div className="relative mt-3 h-14 rounded-lg border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 shadow-sm">
                <input
                    type="range"
                    min={0}
                    max={Math.max(totalTime, 0)}
                    value={Number.isFinite(currentTime) ? currentTime : 0}
                    step={50}
                    onChange={(event) => handleSeek(Number(event.target.value))}
                    className="absolute inset-x-3 top-1/2 h-[6px] -translate-y-1/2 appearance-none bg-transparent"
                    style={{
                        backgroundSize: `${totalTime ? (currentTime / totalTime) * 100 : 0}% 100%`,
                    }}
                />
                <div className="absolute inset-x-3 top-1/2 h-[6px] -translate-y-1/2 overflow-hidden rounded-full bg-slate-200">
                    <div
                        className="h-full bg-slate-900 transition-[width] duration-200"
                        style={{ width: `${Math.min(100, (currentTime / (totalTime || 1)) * 100)}%` }}
                    />
                </div>
                {normalizedMarkers.map((marker) => (
                    <button
                        key={marker.key}
                        type="button"
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                        style={{ left: `${marker.pct}%` }}
                        onMouseEnter={() => setHovered(marker)}
                        onMouseLeave={() => setHovered((prev) => (prev?.key === marker.key ? null : prev))}
                        onFocus={() => setHovered(marker)}
                        onBlur={() => setHovered((prev) => (prev?.key === marker.key ? null : prev))}
                        onClick={() => {
                            handleSeek(marker.position);
                            onMarkerSelect?.(marker);
                        }}
                    >
                        <span
                            className={`block h-3 w-3 rounded-full border border-white shadow ring-2 ring-white/60 transition-transform duration-200 hover:scale-110 focus:scale-110 ${KIND_COLORS[marker.kind] || "bg-slate-400"}`}
                        />
                    </button>
                ))}
                <div
                    className="absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 -translate-x-1/2 rounded-full border-[3px] border-white bg-slate-900 shadow-lg transition-transform duration-200"
                    style={{ left: `${Math.min(100, (currentTime / (totalTime || 1)) * 100)}%` }}
                />
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] uppercase tracking-wide text-slate-400">
                {Object.entries(KIND_COLORS).map(([kind, color]) => (
                    <div key={kind} className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                        <span>{KIND_LABELS[kind]}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
