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
        "t": 1760129094477,
        "type": "enter",
        "fn": "create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.controller.ts",
        "line": 11,
        "depth": 1,
        "args": [
            {
                "name": "one",
                "status": "NEW",
                "__class": "CreateItemDto"
            }
        ]
    },
    {
        "t": 1760129094478,
        "type": "enter",
        "fn": "create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 17,
        "depth": 2,
        "args": [
            {
                "name": "one",
                "status": "NEW",
                "__class": "CreateItemDto"
            }
        ]
    },
    {
        "t": 1760129094478,
        "type": "enter",
        "fn": "this.model.create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 18,
        "depth": 3,
        "args": [
            {
                "name": "one",
                "status": "NEW"
            }
        ]
    },
    {
        "t": 1760129094494,
        "type": "exit",
        "fn": "this.model.create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 18,
        "depth": 2,
        "args": [
            {
                "name": "one",
                "status": "NEW"
            }
        ],
        "returnValue": {
            "$__": {
                "activePaths": {
                    "paths": "[Object depth>3]",
                    "states": "[Object depth>3]",
                    "map": "[Function]",
                    "__class": "ctor"
                },
                "op": null,
                "saving": null,
                "$versionError": null,
                "saveOptions": null,
                "validating": null,
                "cachedRequired": {},
                "backup": {
                    "activePaths": "[Object depth>3]",
                    "validationError": null
                },
                "inserting": true,
                "savedState": {},
                "__class": "InternalCache"
            },
            "_doc": {
                "name": "one",
                "status": "NEW",
                "credits": 0,
                "_id": {
                    "buffer": {
                        "__type": "Buffer",
                        "length": 12,
                        "preview": "68e97046950830cef48b7066"
                    },
                    "__class": "ObjectId"
                },
                "comments": [],
                "createdAt": "2025-10-10T20:44:54.479Z",
                "updatedAt": "2025-10-10T20:44:54.479Z",
                "__v": 0
            },
            "__repro_meta": {
                "wasNew": true,
                "before": null,
                "collection": "items"
            },
            "$isNew": false,
            "__class": "model"
        },
        "error": null,
        "threw": false
    },
    {
        "t": 1760129094494,
        "type": "enter",
        "fn": "test",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 15,
        "depth": 2,
        "args": []
    },
    {
        "t": 1760129094494,
        "type": "enter",
        "fn": "console.log",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 15,
        "depth": 3,
        "args": [
            "test"
        ]
    },
    {
        "t": 1760129094494,
        "type": "enter",
        "fn": "console.log",
        "file": "node:console",
        "line": null,
        "depth": 4
    },
    {
        "t": 1760129094494,
        "type": "exit",
        "fn": "console.log",
        "file": "node:console",
        "line": null,
        "depth": 4,
        "threw": false
    },
    {
        "t": 1760129094494,
        "type": "exit",
        "fn": "console.log",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 15,
        "depth": 3,
        "args": [
            "test"
        ],
        "threw": false
    },
    {
        "t": 1760129094494,
        "type": "enter",
        "fn": "foo",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 14,
        "depth": 3,
        "args": []
    },
    {
        "t": 1760129094494,
        "type": "exit",
        "fn": "foo",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 14,
        "depth": 3,
        "args": [],
        "error": null,
        "threw": false
    },
    {
        "t": 1760129094494,
        "type": "exit",
        "fn": "test",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 15,
        "depth": 2,
        "args": [],
        "error": null,
        "threw": false
    },
    {
        "t": 1760129094494,
        "type": "enter",
        "fn": "doc.toObject",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/node_modules/mongoose/index.js",
        "line": null,
        "depth": 2,
        "args": []
    },
    {
        "t": 1760129094495,
        "type": "exit",
        "fn": "doc.toObject",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/node_modules/mongoose/index.js",
        "line": null,
        "depth": 2,
        "args": [],
        "returnValue": {
            "name": "one",
            "status": "NEW",
            "credits": 0,
            "_id": {
                "buffer": {
                    "__type": "Buffer",
                    "length": 12,
                    "preview": "68e97046950830cef48b7066"
                },
                "__class": "ObjectId"
            },
            "comments": [],
            "createdAt": "2025-10-10T20:44:54.479Z",
            "updatedAt": "2025-10-10T20:44:54.479Z",
            "__v": 0
        },
        "threw": false
    },
    {
        "t": 1760129094495,
        "type": "exit",
        "fn": "create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.service.ts",
        "line": 17,
        "depth": 1,
        "args": [
            {
                "name": "one",
                "status": "NEW",
                "__class": "CreateItemDto"
            }
        ],
        "returnValue": {
            "name": "one",
            "status": "NEW",
            "credits": 0,
            "_id": {
                "buffer": {
                    "__type": "Buffer",
                    "length": 12,
                    "preview": "68e97046950830cef48b7066"
                },
                "__class": "ObjectId"
            },
            "comments": [],
            "createdAt": "2025-10-10T20:44:54.479Z",
            "updatedAt": "2025-10-10T20:44:54.479Z",
            "__v": 0
        },
        "error": null,
        "threw": false
    },
    {
        "t": 1760129094495,
        "type": "exit",
        "fn": "create",
        "file": "/Users/mihransahakyan/projects/repro/repor-nest-e2e/src/items/items.controller.ts",
        "line": 11,
        "depth": 3,
        "args": [
            {
                "name": "one",
                "status": "NEW",
                "__class": "CreateItemDto"
            }
        ],
        "returnValue": {
            "name": "one",
            "status": "NEW",
            "credits": 0,
            "_id": {
                "buffer": {
                    "__type": "Buffer",
                    "length": 12,
                    "preview": "68e97046950830cef48b7066"
                },
                "__class": "ObjectId"
            },
            "comments": [],
            "createdAt": "2025-10-10T20:44:54.479Z",
            "updatedAt": "2025-10-10T20:44:54.479Z",
            "__v": 0
        },
        "error": null,
        "threw": false
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