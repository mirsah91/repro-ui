// import React from "react";
// import ChunkReplay from "./pages/ChunkReplay.jsx";
//
// export default function App() {
//     return <ChunkReplay />;
// }


import React from "react";
import SessionReplay from "./pages/SessionReplay";

// quick demo: hardcode a sessionId or read from URL hash/query
const sessionIdFromHash = () => {
    const h = (location.hash || "").replace(/^#\/?/, "");
    const m = h.match(/^s\/(.+)$/);
    return m ? m[1] : null;
};

export default function App() {
    const sid = sessionIdFromHash() || new URLSearchParams(location.search).get("sessionId") || "";
    return sid ? (
        <SessionReplay sessionId={sid} />
    ) : (
        <div style={{ padding: 24 }}>
            <h2>Replay</h2>
            <p>Add <code>?sessionId=YOUR_SESSION_ID</code> to the URL.</p>
            <p>Or use hash: <code>#/s/YOUR_SESSION_ID</code></p>
        </div>
    );
}
