import React, { useMemo } from "react";
import "./FunctionTracerViewer.css";

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTrace(trace) {
  return trace
    .filter(Boolean)
    .map((event, index) => ({
      ...event,
      index,
      type: typeof event.type === "string" ? event.type.toLowerCase() : event.type,
      depth: asNumber(event.depth),
      time: asNumber(event.t, index),
    }))
    .sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.index - b.index;
    });
}

function buildCallTree(events) {
  const stack = [];
  const roots = [];

  events.forEach((event) => {
    if (event.type === "enter") {
      const call = {
        id: `call-${event.index}`,
        enter: event,
        exit: null,
        children: [],
      };

      if (stack.length) {
        stack[stack.length - 1].children.push(call);
      } else {
        roots.push(call);
      }

      stack.push(call);
      return;
    }

    if (event.type === "exit") {
      const call = stack.pop();

      if (!call) {
        roots.push({
          id: `orphan-exit-${event.index}`,
          enter: null,
          exit: event,
          children: [],
        });
        return;
      }

      call.exit = event;
      return;
    }

    const node = {
      id: `event-${event.index}`,
      enter: event,
      exit: null,
      children: [],
      isEventOnly: true,
    };

    if (stack.length) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
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

function trimPath(file) {
  if (!file) return "";
  const parts = file.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return parts.join("/");
  return parts.slice(-3).join("/");
}

function formatDuration(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const duration = end - start;
  if (!Number.isFinite(duration) || duration < 0) return null;
  if (duration < 1) return `${(duration * 1000).toFixed(2)} µs`;
  if (duration < 1000) return `${duration.toFixed(2)} ms`;
  return `${(duration / 1000).toFixed(2)} s`;
}

function CallDetails({ label, value, isError }) {
  return (
    <div className={`call-card__section${isError ? " call-card__section--error" : ""}`}>
      <span className="call-card__label">{label}</span>
      <pre className="call-card__value">{value}</pre>
    </div>
  );
}

function CallNode({ call, depth = 0 }) {
  const enter = call.enter;
  const exit = call.exit;
  const name = enter?.fn || exit?.fn || "(anonymous)";
  const locationFile = enter?.file || exit?.file;
  const locationLine = enter?.line ?? exit?.line;
  const location = locationFile
    ? `${trimPath(locationFile)}${locationLine != null ? `:${locationLine}` : ""}`
    : "Unknown location";
  const duration = enter && exit ? formatDuration(enter.time, exit.time) : null;
  const hasChildren = call.children && call.children.length > 0;
  const statusClass = exit?.error || exit?.threw ? " call-card--error" : "";
  const bodySections = [];

  if (!call.isEventOnly) {
    bodySections.push(
      <CallDetails key="args" label="Arguments" value={formatArgs(enter?.args)} />
    );
  }

  if (exit && exit.returnValue !== undefined) {
    bodySections.push(
      <CallDetails key="return" label="Return value" value={formatJSON(exit.returnValue)} />
    );
  }

  if (exit && (exit.error || exit.threw)) {
    bodySections.push(
      <CallDetails
        key="error"
        label={exit.threw ? "Threw" : "Error"}
        value={formatJSON(exit.error)}
        isError
      />
    );
  }

  if (call.isEventOnly) {
    bodySections.push(
      <CallDetails key="event" label="Event" value={formatJSON(enter)} />
    );
  }

  return (
    <div className="call-node" style={{ marginLeft: depth * 1.5 + "rem" }}>
      <div className={`call-card${statusClass}`}>
        <div className="call-card__header">
          <div className="call-card__title">
            <span className="call-card__fn">{name}</span>
            <span className="call-card__location">{location}</span>
          </div>
          <div className="call-card__meta">
            {enter?.type && <span className="call-card__badge">{enter.type}</span>}
            {duration && <span className="call-card__duration">{duration}</span>}
          </div>
        </div>
        <div className="call-card__body">{bodySections}</div>
      </div>
      {hasChildren && (
        <div className="call-node__children">
          {call.children.map((child) => (
            <CallNode key={child.id} call={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FunctionTracerViewer({ trace = [] }) {
  const calls = useMemo(() => buildCallTree(normalizeTrace(trace)), [trace]);

  if (!calls.length) {
    return <div className="function-tracer-viewer function-tracer-viewer--empty">No trace events</div>;
  }

  return (
    <div className="function-tracer-viewer">
      <header className="function-tracer-viewer__header">
        <h2>Function trace</h2>
        <span>{calls.length} root call{calls.length === 1 ? "" : "s"}</span>
      </header>
      <div className="function-tracer-viewer__tree">
        {calls.map((call) => (
          <CallNode key={call.id} call={call} />
        ))}
      </div>
    </div>
  );
}
