// Desktop -> web "Continue on web" handoff codec.
//
// PRIVACY: only the editor STYLE + annotation OPS are serialized here — never
// the raw image bytes. The encoded payload rides in a URL *fragment*
// (`#handoff=...`), which browsers never send to the server, so the screenshot
// stays entirely on the user's device. The web side re-prompts for the image.
//
// The payload is versioned (`v`) so old hand-off links keep decoding as the
// schema evolves.

export const HANDOFF_VERSION = 1;
export const HANDOFF_PARAM = "handoff";

/**
 * @typedef {Object} HandoffPayload
 * @property {number} v      Schema version (currently 1).
 * @property {object} style  Result of editor.snapshotStyle().
 * @property {Array<object>} ops  The editor annotation ops array (plain JSON).
 */

/** UTF-8 safe base64url encode of a string. */
function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** UTF-8 safe base64url decode back to a string. */
function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Encode a handoff payload to a base64url string suitable for a URL fragment.
 * @param {{ style: object, ops: Array<object> }} input
 * @returns {string}
 */
export function encodeHandoff(input) {
  const payload = {
    v: HANDOFF_VERSION,
    style: input.style ?? null,
    ops: Array.isArray(input.ops) ? input.ops : [],
  };
  return toBase64Url(JSON.stringify(payload));
}

/**
 * Decode a base64url handoff string. Returns null when absent/malformed or when
 * the version is unknown, so callers can safely ignore bad links.
 * @param {string | null | undefined} encoded
 * @returns {HandoffPayload | null}
 */
export function decodeHandoff(encoded) {
  if (!encoded) return null;
  try {
    const payload = JSON.parse(fromBase64Url(encoded));
    if (!payload || typeof payload !== "object") return null;
    if (payload.v !== HANDOFF_VERSION) return null;
    return {
      v: payload.v,
      style: payload.style ?? null,
      ops: Array.isArray(payload.ops) ? payload.ops : [],
    };
  } catch {
    return null;
  }
}

/** Read + decode the handoff payload from a URL fragment (e.g. location.hash). */
export function readHandoffFromHash(hash) {
  if (!hash) return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  return decodeHandoff(params.get(HANDOFF_PARAM));
}
