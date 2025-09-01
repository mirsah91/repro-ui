export function b64ToUtf8(b64) {
    const clean = (b64 || "").trim().replace(/^"|"$/g, "").replace(/\s+/g, "");
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
}

export function decodeBase64JsonArray(b64) {
    const text = b64ToUtf8(b64);
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.events)) return parsed.events;
    throw new Error("Not an rrweb events array");
}
