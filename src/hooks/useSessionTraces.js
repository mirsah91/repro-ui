import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

function decodeBase64(text) {
    if (!text) return null;
    if (typeof atob === "function") {
        try { return atob(text); } catch { /* ignore */ }
    }
    if (typeof Buffer !== "undefined") {
        try { return Buffer.from(text, "base64").toString("utf-8"); } catch { /* ignore */ }
    }
    return null;
}

function parseNdjson(text) {
    const lines = String(text)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) return null;
    const out = [];
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            out.push(parsed);
        } catch {
            return null;
        }
    }
    return out;
}

function parseTraceEvents(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload.filter(Boolean);
    if (typeof payload === "object") {
        if (Array.isArray(payload.events)) return payload.events.filter(Boolean);
        if (payload.events) return parseTraceEvents(payload.events);
        if (Array.isArray(payload.data)) return payload.data.filter(Boolean);
        if (payload.data) return parseTraceEvents(payload.data);
        return [];
    }
    if (typeof payload !== "string") return [];

    const trimmed = payload.trim();
    if (!trimmed) return [];

    const tryParseJson = (text) => {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed.filter(Boolean);
            if (parsed && Array.isArray(parsed.events)) return parsed.events.filter(Boolean);
            return null;
        } catch {
            return null;
        }
    };

    const fromJson = tryParseJson(trimmed);
    if (fromJson) return fromJson;

    const fromNdjson = parseNdjson(trimmed);
    if (fromNdjson) return fromNdjson;

    const decoded = decodeBase64(trimmed);
    if (decoded) {
        const decodedJson = tryParseJson(decoded);
        if (decodedJson) return decodedJson;
        const decodedNdjson = parseNdjson(decoded);
        if (decodedNdjson) return decodedNdjson;
    }

    return [];
}

function normalizeTraceItems(rawItems = []) {
    const entries = [];

    rawItems.forEach((group, groupIndex) => {
        (group.traces || []).forEach((trace, traceIndex) => {
            const batches = trace?.batches || [];
            const events = [];
            let declaredTotal = 0;

            batches.forEach((batch) => {
                const batchTrace = batch?.trace ?? {};
                const payload = batchTrace.events ?? batchTrace.data ?? batchTrace;
                const parsed = parseTraceEvents(payload);
                if (parsed.length) events.push(...parsed);
                if (Number.isFinite(batchTrace.total)) declaredTotal += Number(batchTrace.total);
                else if (Array.isArray(batchTrace.events)) declaredTotal += batchTrace.events.length;
                else if (parsed.length) declaredTotal += parsed.length;
            });

            const idParts = [group.key || `group-${groupIndex}`, trace.requestRid || `trace-${traceIndex}`];
            const id = idParts.join("::");
            const requestMeta = trace?.request || {};
            const label = requestMeta.key || group.key || `Trace ${entries.length + 1}`;
            const total = declaredTotal || events.length;

            entries.push({
                id,
                groupKey: group.key,
                requestRid: trace.requestRid,
                request: requestMeta,
                batches,
                events,
                total,
                label,
            });
        });
    });

    return entries;
}

export default function useSessionTraces(sessionId) {
    const [status, setStatus] = useState("idle");
    const [error, setError] = useState(null);
    const [rawItems, setRawItems] = useState([]);

    useEffect(() => {
        if (!sessionId) {
            setRawItems([]);
            setStatus("idle");
            setError(null);
            return undefined;
        }

        let aborted = false;
        setStatus("loading");
        setError(null);
        setRawItems([]);

        (async () => {
            try {
                const response = await fetch(`${API_BASE}/v1/sessions/${sessionId}/traces`);
                if (!response.ok) throw new Error(`Trace request failed with status ${response.status}`);
                const json = await response.json();
                if (aborted) return;
                setRawItems(json?.items || []);
                setStatus("ready");
            } catch (err) {
                if (aborted) return;
                console.error("[repro:trace] failed to load traces", err);
                setError(err);
                setStatus("error");
            }
        })();

        return () => {
            aborted = true;
        };
    }, [sessionId]);

    const entries = useMemo(() => normalizeTraceItems(rawItems), [rawItems]);

    return { status, error, items: rawItems, entries };
}
