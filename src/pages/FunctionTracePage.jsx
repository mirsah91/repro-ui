import {FunctionTraceViewer} from "../components/FunctionTracerViewer.jsx";
import {useState} from "react";

// const sample = [
//     { t: 1000, type: "enter", fn: "canActivate", file: "/app/auth.guard.js", line: 31, depth: 1 },
//     { t: 1020, type: "enter", fn: "getRequest", file: "/app/auth.guard.js", line: 32, depth: 2 },
//     { t: 1030, type: "exit",  fn: "getRequest", file: "/app/auth.guard.js", line: 32, depth: 2 },
//     { t: 1040, type: "enter", fn: "handlePassportAuthentication", file: "/app/auth.guard.js", line: 57, depth: 2 },
//     { t: 1050, type: "enter", fn: "authenticate", file: "/app/bearer.strategy.js", line: 59, depth: 3 },
//     { t: 1150, type: "exit",  fn: "authenticate", file: "/app/bearer.strategy.js", line: 59, depth: 3 },
//     { t: 1200, type: "exit",  fn: "handlePassportAuthentication", file: "/app/auth.guard.js", line: 57, depth: 2 },
//     { t: 1210, type: "enter", fn: "verify", file: "/app/auth.controller.js", line: 32, depth: 2 },
//     { t: 1310, type: "exit",  fn: "verify", file: "/app/auth.controller.js", line: 32, depth: 2 },
//     { t: 1320, type: "exit",  fn: "canActivate", file: "/app/auth.guard.js", line: 31, depth: 1 },
// ];

const sample = [
    {
        "t": 1759875080831,
        "type": "enter",
        "fn": "enter",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.controller.ts",
        "line": null,
        "depth": 1
    },
    {
        "t": 1759875080831,
        "type": "enter",
        "fn": "create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.controller.ts",
        "line": 11,
        "depth": 2
    },
    {
        "t": 1759875080831,
        "type": "exit",
        "fn": "enter",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.controller.ts",
        "line": null,
        "depth": 2
    },
    {
        "t": 1759875080831,
        "type": "enter",
        "fn": "enter",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 2
    },
    {
        "t": 1759875080831,
        "type": "enter",
        "fn": "create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 17,
        "depth": 3
    },
    {
        "t": 1759875080831,
        "type": "exit",
        "fn": "enter",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 3
    },
    {
        "t": 1759875080831,
        "type": "enter",
        "fn": "create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 18,
        "depth": 3
    },
    {
        "t": 1759875080834,
        "type": "enter",
        "fn": "exit",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.controller.ts",
        "line": null,
        "depth": 4
    },
    {
        "t": 1759875080834,
        "type": "exit",
        "fn": "create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.controller.ts",
        "line": 11,
        "depth": 4
    },
    {
        "t": 1759875080834,
        "type": "exit",
        "fn": "exit",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.controller.ts",
        "line": null,
        "depth": 3
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 18,
        "depth": 2
    },
    {
        "t": 1759875080857,
        "type": "enter",
        "fn": "enter",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 2
    },
    {
        "t": 1759875080857,
        "type": "enter",
        "fn": "test",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 15,
        "depth": 3
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "enter",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 3
    },
    {
        "t": 1759875080857,
        "type": "enter",
        "fn": "log",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 15,
        "depth": 3
    },
    {
        "t": 1759875080857,
        "type": "enter",
        "fn": "console.log",
        "file": "node:console",
        "line": null,
        "depth": 4
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "console.log",
        "file": "node:console",
        "line": null,
        "depth": 4
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "log",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 15,
        "depth": 3
    },
    {
        "t": 1759875080857,
        "type": "enter",
        "fn": "enter",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 3
    },
    {
        "t": 1759875080857,
        "type": "enter",
        "fn": "foo",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 14,
        "depth": 4
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "enter",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 4
    },
    {
        "t": 1759875080857,
        "type": "enter",
        "fn": "exit",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 4
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "foo",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 14,
        "depth": 4
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "exit",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 3
    },
    {
        "t": 1759875080857,
        "type": "enter",
        "fn": "exit",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 3
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "test",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 15,
        "depth": 3
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "exit",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 2
    },
    {
        "t": 1759875080857,
        "type": "enter",
        "fn": "toObject",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 23,
        "depth": 2
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "toObject",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 23,
        "depth": 2
    },
    {
        "t": 1759875080857,
        "type": "enter",
        "fn": "exit",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 2
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 17,
        "depth": 2
    },
    {
        "t": 1759875080857,
        "type": "exit",
        "fn": "exit",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": null,
        "depth": 1
    }
]

export default function Demo() {
    const [now, setNow] = useState(1150);
    const onSeek = (t) => setNow(t);
    return (
        <div className="p-4">
            <h1 className="text-lg font-semibold mb-2">Function Call Trace</h1>
            <FunctionTraceViewer trace={sample} now={now} onSeek={onSeek} />
        </div>
    );
}