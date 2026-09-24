import type { IceServer } from "@racing/shared";

/** Public STUN only: pairs behind NATs that STUN cannot open stay on the relay (ADR-0009). */
export const DEFAULT_ICE_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const isString = (value: unknown): value is string => typeof value === "string";
/** Schemes RTCPeerConnection accepts; anything else makes its constructor throw. */
const ICE_URL = /^(stuns?|turns?):/;

/**
 * Read the ICE servers handed to clients for Direct Links from the `ICE_SERVERS`
 * JSON array, e.g. to add a TURN server or to empty the list for a loopback-only
 * test run. Unset or malformed falls back to public STUN.
 */
export function parseIceServers(raw: string | undefined): IceServer[] {
  if (raw === undefined) return DEFAULT_ICE_SERVERS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new TypeError("not an array");
    return value.map((entry: unknown) => {
      const { urls, username, credential } = (entry ?? {}) as Record<string, unknown>;
      const list: unknown[] = Array.isArray(urls) ? urls : [urls];
      if (list.length === 0 || !list.every((url) => isString(url) && ICE_URL.test(url)))
        throw new TypeError("urls must be one or more stun:, stuns:, turn: or turns: URLs");
      if (
        list.some((url) => (url as string).startsWith("turn")) &&
        !(isString(username) && isString(credential))
      )
        throw new TypeError("a TURN server needs a username and credential");
      return {
        urls: urls as string | string[],
        ...(isString(username) && { username }),
        ...(isString(credential) && { credential }),
      };
    });
  } catch (error) {
    console.error("Ignoring malformed ICE_SERVERS:", error);
    return DEFAULT_ICE_SERVERS;
  }
}
