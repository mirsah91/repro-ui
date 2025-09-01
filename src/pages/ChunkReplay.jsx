import React, { useEffect, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/rrweb.min.css";

function b64ToUtf8(b64) {
    const clean = (b64 || "").trim().replace(/^"|"$/g, "").replace(/\s+/g, "");
    const bin = atob(clean);                     // base64 -> binary (latin1)
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes); // bytes -> proper UTF-8 string
}

function decodeBase64JsonArray(b64) {
    const text = b64ToUtf8(b64);
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.events)) return parsed.events;
    throw new Error("Not an rrweb events array");
}


export default function ChunkReplay() {
    const [b64, setB64] = useState("");
    const [error, setError] = useState(null);
    const hostRef = useRef(null);
    const replayerRef = useRef(null);

    useEffect(() => {
        return () => {
            if (replayerRef.current) {
                replayerRef.current.pause();
                replayerRef.current = null;
            }
        };
    }, []);

    const handlePlay = () => {
        setError(null);
        try {
            const events = decodeBase64JsonArray(b64);

            if (replayerRef.current) {
                replayerRef.current.pause();
                replayerRef.current = null;
            }
            if (hostRef.current) hostRef.current.innerHTML = "";

            replayerRef.current = new Replayer(events, {
                root: hostRef.current || undefined,
                mouseTail: true,
                UNSAFE_replayCanvas: true,
                speed: 1,
            });
            replayerRef.current.play();
        } catch (e) {
            setError(e?.message || String(e));
        }
    };

    return (
        <div className="p-6 space-y-4">
            <h1 className="text-xl font-semibold">Replay a Single rrweb Chunk</h1>

            <p className="text-sm text-gray-600">
                Paste the <code>rrweb_chunks.data</code> base64 string from your DB:
            </p>

            <textarea
                className="w-full h-40 rounded border p-2 font-mono text-xs"
                placeholder="paste base64 here…"
                value={b64}
                onChange={(e) => setB64(e.target.value)}
            />

            <div className="flex items-center gap-2">
                <button
                    onClick={handlePlay}
                    className="px-3 py-2 rounded bg-black text-white text-sm"
                >
                    Play
                </button>
                {error && <span className="text-red-600 text-sm">{error}</span>}
            </div>

            <div
                ref={hostRef}
                className="border rounded w-full h-[70vh] overflow-hidden bg-white"
            />
        </div>
    );
}
