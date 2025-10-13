import React from "react";
import { addrList, decodeMaybeBase64 } from "../lib/emailRender";

export default function EmailItem({ meta }) {
    const [open, setOpen] = React.useState(false);
    const iframeRef = React.useRef(null);
    const [iframeHeight, setIframeHeight] = React.useState(300);

    const to = addrList(meta.to);
    const cc = addrList(meta.cc);
    const bcc = addrList(meta.bcc);

    const hasHtml = typeof meta.html === "string" && meta.html.length > 0;
    const hasText = typeof meta.text === "string" && meta.text.length > 0;
    const htmlDecoded = hasHtml ? decodeMaybeBase64(meta.html) : null;

    // resize iframe after load
    React.useEffect(() => {
        if (!open || !iframeRef.current) return;
        const iframe = iframeRef.current;
        const handler = () => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                if (doc && doc.body && doc.body.scrollHeight) {
                    setIframeHeight(Math.min(doc.body.scrollHeight + 20, window.innerHeight - 100));
                }
            } catch {
                /* ignore cross-origin */
            }
        };
        iframe.addEventListener("load", handler);
        return () => iframe.removeEventListener("load", handler);
    }, [open]);

    return (
        <div className="space-y-2 text-sm text-white/80">
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-white break-words">{meta.subject ?? "(no subject)"}</div>
                <div className="shrink-0 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] uppercase tracking-widest text-white/70">
                    {(meta.provider ?? "email")} • {(meta.statusCode ?? "—")}
                </div>
            </div>

            {/* Meta */}
            <div className="space-y-1 text-xs text-white/60">
                <div>
                    <span className="font-semibold text-white/70">From:</span>{" "}
                    {meta.from?.name ? `${meta.from.name} <${meta.from.email}>` : meta.from?.email ?? "—"}
                </div>
                <div><span className="font-semibold text-white/70">To:</span> {to.length ? to.join(", ") : "—"}</div>
                {!!cc.length && <div><span className="font-semibold text-white/70">Cc:</span> {cc.join(", ")}</div>}
                {!!bcc.length && <div><span className="font-semibold text-white/70">Bcc:</span> {bcc.join(", ")}</div>}
            </div>

            {/* Body trigger */}
            {(hasHtml || hasText) && (
                <div className="pt-1">
                    <button
                        onClick={() => setOpen(true)}
                        className="text-xs font-medium text-sky-300 transition hover:text-sky-200"
                    >
                        View email body
                    </button>
                </div>
            )}

            {/* Modal */}
            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur"
                    onClick={() => setOpen(false)}
                >
                    <div
                        className="flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl"
                        style={{ maxHeight: "90vh" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal header */}
                        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3 text-sm text-white/70">
                            <div className="font-semibold text-white">{meta.subject ?? "(no subject)"}</div>
                            <button
                                onClick={() => setOpen(false)}
                                className="rounded-full border border-white/10 px-3 py-1 text-xs font-medium text-white/70 transition hover:border-white/30 hover:bg-white/10"
                            >
                                Close
                            </button>
                        </div>

                        {/* Modal body */}
                        <div className="flex-1 overflow-auto bg-slate-950/60 p-4">
                            {hasHtml ? (
                                <iframe
                                    ref={iframeRef}
                                    title="email-html"
                                    sandbox="allow-same-origin"
                                    className="w-full rounded-xl border border-white/10 bg-white"
                                    style={{ height: iframeHeight }}
                                    srcDoc={htmlDecoded ?? ""}
                                />
                            ) : (
                                <pre className="whitespace-pre-wrap rounded-xl border border-white/10 bg-slate-900/70 p-4 text-[13px] leading-relaxed text-white/80">{meta.text}</pre>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
