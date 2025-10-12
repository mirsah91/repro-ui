import { useMemo } from "react";
import { FunctionTraceViewer } from "../components/FunctionTracerViewer.jsx";

const sampleTrace = [
  { type: "enter", fn: "calculateInvoice", args: [{ items: 3, subtotal: 120.45 }, "2025-03"], file: "services/invoice.ts", line: 12, t: 0 },
  { type: "enter", fn: "fetchTaxRate", args: ["NY"], file: "services/tax.ts", line: 44, t: 0.9 },
  { type: "exit", fn: "fetchTaxRate", returnValue: 0.0875, file: "services/tax.ts", line: 44, t: 1.8 },
  {
    type: "enter",
    fn: "applyDiscount",
    args: [120.45, { code: "VIP", percent: 15 }],
    file: "services/discount.ts",
    line: 28,
    t: 2.3
  },
  {
    type: "exit",
    fn: "applyDiscount",
    threw: true,
    error: { message: "Discount expired", code: "EXPIRED" },
    file: "services/discount.ts",
    line: 28,
    t: 3.1
  },
  { type: "log", fn: "event", message: "fallback pricing", file: "services/invoice.ts", line: 32, t: 3.4 },
  {
    type: "enter",
    fn: "calculateSurcharge",
    args: [120.45, 0.0875],
    file: "services/invoice.ts",
    line: 36,
    t: 4.1
  },
  {
    type: "exit",
    fn: "calculateSurcharge",
    returnValue: { surcharge: 10.54 },
    file: "services/invoice.ts",
    line: 36,
    t: 5.6
  },
  {
    type: "exit",
    fn: "calculateInvoice",
    returnValue: { total: 131.22, currency: "USD", meta: { retries: 1, discountApplied: false } },
    file: "services/invoice.ts",
    line: 12,
    t: 7.2
  }
];

export default function FunctionTracePage() {
  const trace = useMemo(() => sampleTrace, []);

  return (
    <div style={{ padding: "24px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "min(1080px, 100%)" }}>
        <FunctionTraceViewer trace={trace} title="Function Trace Debugger" />
      </div>
    </div>
  );
}
