import React, { useMemo } from "react";
import "./FunctionTracerViewer.css";

const TYPE_INFO = {
  enter: { label: "Enter", color: "#2563eb" },
  exit: { label: "Exit", color: "#dc2626" },
  leave: { label: "Leave", color: "#dc2626" },
  error: { label: "Error", color: "#f97316" },
};

const UNKNOWN_TYPE = { label: "Event", color: "#6b7280" };

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatJSON(value) {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }

  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > 240 ? `${json.slice(0, 237)}…` : json;
  } catch (error) {
    return String(value);
  }
}

function formatArgs(args) {
  if (!args || args.length === 0) return "—";
  if (!Array.isArray(args)) return formatJSON(args);
  return args
    .map((arg, index) => {
      const value = formatJSON(arg);
      return args.length === 1 ? value : `${index + 1}. ${value}`;
    })
    .join("\n");
}

function normalizeTrace(trace) {
  return trace
    .filter(Boolean)
    .map((event, index) => ({
      ...event,
      index,
      depth: asNumber(event.depth),
      time: asNumber(event.t, index),
    }))
    .sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.index - b.index;
    });
}

function TraceRow({ event }) {
  const type = TYPE_INFO[event.type] ?? UNKNOWN_TYPE;
  const location = event.file
    ? `${event.file}${event.line ? `:${event.line}` : ""}`
    : "Unknown location";

  return (
    <div
      className="trace-row"
      style={{
        borderLeftColor: type.color,
        marginLeft: `${event.depth * 1.5}rem`,
      }}
    >
      <div className="trace-row__header">
        <span className="trace-row__type" style={{ backgroundColor: type.color }}>
          {type.label}
        </span>
        <span className="trace-row__fn">{event.fn || "(anonymous)"}</span>
        <span className="trace-row__location">{location}</span>
      </div>
      <div className="trace-row__body">
        <div className="trace-row__section">
          <span className="trace-row__label">Arguments</span>
          <pre className="trace-row__value">{formatArgs(event.args)}</pre>
        </div>
        {event.returnValue !== undefined && (
          <div className="trace-row__section">
            <span className="trace-row__label">Return value</span>
            <pre className="trace-row__value">{formatJSON(event.returnValue)}</pre>
          </div>
        )}
        {event.error && (
          <div className="trace-row__section trace-row__section--error">
            <span className="trace-row__label">Error</span>
            <pre className="trace-row__value">{formatJSON(event.error)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FunctionTracerViewer({ trace = [] }) {
  const events = useMemo(() => normalizeTrace(trace), [trace]);

  if (!events.length) {
    return <div className="function-tracer-viewer function-tracer-viewer--empty">No trace events</div>;
  }

  return (
    <div className="function-tracer-viewer">
      <header className="function-tracer-viewer__header">
        <h2>Function trace</h2>
        <span>{events.length} events</span>
      </header>
      <div className="function-tracer-viewer__list">
        {events.map((event) => (
          <TraceRow key={`${event.index}-${event.time}`} event={event} />
        ))}
      </div>
    </div>
  );
}
