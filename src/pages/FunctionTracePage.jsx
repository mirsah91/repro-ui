import {FunctionTraceViewer} from "../components/FunctionTracerViewer.jsx";
import {useState} from "react";

// export default function Demo() {
//     const [now, setNow] = useState(1150);
//     const onSeek = (t) => setNow(t);
//     return (
//         <div className="p-4">
//             <h1 className="text-lg font-semibold mb-2">Function Call Trace</h1>
//             <FunctionTraceViewer trace={sample} now={now} onSeek={onSeek} />
//         </div>
//     );
// }