import { useMemo } from "react";
import { FunctionTraceViewer } from "../components/FunctionTracerViewer.jsx";


export default function FunctionTracePage() {
  const trace = useMemo(() => [], []);

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "48px clamp(32px, 6vw, 72px)",
        background: "radial-gradient(circle at top, rgba(42,78,170,0.4), transparent 55%), #02040a",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <FunctionTraceViewer trace={trace} title="Function Call Trace" />
    </div>
  );
}
