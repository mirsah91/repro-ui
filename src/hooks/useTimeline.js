import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

/**
 * Fetches flat, time-sorted ticks from /v1/sessions/:id/timeline
 * Each tick has: { kind, t, meta, ... } where `t` is in *server ms*
 */
export default function useTimeline(sessionId) {
    const [items, setItems] = useState([]);

    useEffect(() => {
        if (!sessionId) return;
        let aborted = false;

        (async () => {
            const r = await fetch(`${API_BASE}/v1/sessions/${sessionId}/full?includeRrweb=1`);
            const j = await r.json();

            const out = [];

            for (const a of j.actions ?? []) {
                // Action (window [tStart..tEnd])
                out.push({
                    kind: "action",
                    actionId: a.actionId,
                    tStart: a.tStart,
                    tEnd: a.tEnd,
                    t: a.tStart ?? a.tEnd,
                    label: a.label,
                    ui: a.ui,
                });

                // Requests
                for (const req of a.requests ?? []) {
                    out.push({ kind: "request", actionId: a.actionId, t: req.t, meta: req });
                }
                // DB
                for (const db of a.db ?? []) {
                    out.push({ kind: "db", actionId: a.actionId, t: db.t, meta: db });
                }
                // Emails ✅
                for (const em of a.emails ?? []) {
                    out.push({ kind: "email", actionId: a.actionId, t: em.t, meta: em });
                }
            }

            // Optional: emails not tied to actions
            // for (const em of j.emails ?? []) out.push({ kind: "email", actionId: em.actionId ?? null, t: em.t, meta: em });

            if (!aborted) setItems(out);
        })();

        return () => { aborted = true; };
    }, [sessionId]);

    return items;
}
