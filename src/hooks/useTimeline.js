import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

/**
 * Fetches flat, time-sorted ticks from /v1/sessions/:id/timeline
 * Each tick has: { kind, t, meta, ... } where `t` is in *server ms*
 */
export default function useTimeline(sessionId) {
    const [ticks, setTicks] = useState([]);
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const r = await fetch(`${API_BASE}/v1/sessions/${sessionId}/timeline`);
                const j = await r.json();
                if (mounted) setTicks(j?.ticks || []);
            } catch {
                if (mounted) setTicks([]);
            }
        })();
        return () => { mounted = false; };
    }, [sessionId]);
    return ticks;
}
