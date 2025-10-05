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
        <div className="text-sm">
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
                <div className="font-medium break-words text-gray-700">{meta.subject ?? "(no subject)"}</div>
                <div className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 border text-gray-700">
                    {(meta.provider ?? "email")} • {(meta.statusCode ?? "—")}
                </div>
            </div>

            {/* Meta */}
            <div className="text-xs text-gray-600 mt-1">
                <div>
                    <span className="font-medium">From:</span>{" "}
                    {meta.from?.name ? `${meta.from.name} <${meta.from.email}>` : meta.from?.email ?? "—"}
                </div>
                <div><span className="font-medium">To:</span> {to.length ? to.join(", ") : "—"}</div>
                {!!cc.length && <div><span className="font-medium">Cc:</span> {cc.join(", ")}</div>}
                {!!bcc.length && <div><span className="font-medium">Bcc:</span> {bcc.join(", ")}</div>}
            </div>

            {/* Body trigger */}
            {(hasHtml || hasText) && (
                <div className="mt-2">
                    <button
                        onClick={() => setOpen(true)}
                        className="text-xs underline text-blue-700"
                    >
                        View email body
                    </button>
                </div>
            )}

            {/* Modal */}
            {open && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4"
                    onClick={() => setOpen(false)}
                >
                    <div
                        className="bg-white rounded shadow-lg w-full max-w-5xl flex flex-col"
                        style={{ maxHeight: "90vh" }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal header */}
                        <div className="p-3 border-b flex justify-between items-center text-gray-600">
                            <div className="font-medium text-sm">{meta.subject ?? "(no subject)"}</div>
                            <button
                                onClick={() => setOpen(false)}
                                className="text-xs px-2 py-1 border rounded hover:bg-gray-100 text-gray-600"
                            >
                                Close
                            </button>
                        </div>

                        {/* Modal body */}
                        <div className="p-2 overflow-auto">
                            {hasHtml ? (
                                <iframe
                                    ref={iframeRef}
                                    title="email-html"
                                    sandbox="allow-same-origin"
                                    className="w-full border"
                                    style={{ height: iframeHeight }}
                                    srcDoc={htmlDecoded ?? ""}
                                />
                            ) : (
                                <pre className="p-3 text-[13px] whitespace-pre-wrap">{meta.text}</pre>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
