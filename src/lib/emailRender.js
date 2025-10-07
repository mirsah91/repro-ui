export function isLikelyBase64(s) {
    if (!s || typeof s !== "string") return false;
    if (s.length < 64) return false;
    return /^[A-Za-z0-9+/=\s]+$/.test(s);
}

export function decodeMaybeBase64(s) {
    if (!s) return null;
    try {
        if (isLikelyBase64(s)) {
            const bin = atob(s.replace(/\s+/g, ""));
            const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
            return new TextDecoder("utf-8").decode(bytes);
        }
        return s;
    } catch {
        return s;
    }
}

export function addrList(arr) {
    return (arr ?? [])
        .map(a => (a && a.email ? (a.name ? `${a.name} <${a.email}>` : a.email) : null))
        .filter(Boolean);
}
