/**
 * Limits and wire constants shared by the worker, the web client and (mirrored by hand,
 * checked by tests) the Python collector. Keep them here so the components cannot drift.
 */

/** WebSocket subprotocol the browser offers and the worker echoes back. */
export const WS_SUBPROTOCOL = 'ai-office';

/** Largest WebSocket message accepted from the collector. */
export const MAX_COLLECTOR_MESSAGE_BYTES = 256 * 1024;

/**
 * How many feed events the worker keeps. Each `state` message carries only the newest
 * `FEED_IN_STATE` of them to keep frequent updates light on mobile networks.
 */
export const FEED_LIMIT = 300;
export const FEED_IN_STATE = 100;

/** The collector counts as online if it sent anything within this window. */
export const COLLECTOR_ONLINE_WINDOW_MS = 90_000;

/**
 * A snapshot older than this is shown as stale in the UI, and the relay refuses to forward
 * snapshots older than {@link RELAY_MAX_SNAPSHOT_AGE_MS} (a dead exporter must be visible).
 */
export const SNAPSHOT_STALE_AFTER_MS = 60_000;
export const RELAY_MAX_SNAPSHOT_AGE_MS = 30_000;

/** WebSocket close codes used by the worker. 4000–4999 are reserved for applications. */
export const CloseCode = {
  /** Generic protocol violation (repeated invalid messages). */
  PolicyViolation: 1008,
  /** Message exceeded {@link MAX_COLLECTOR_MESSAGE_BYTES}. */
  MessageTooBig: 1009,
  /** The viewer's session expired while the socket was open; the client must re-authenticate. */
  SessionExpired: 4401,
  /** A newer collector connection replaced this one; the collector should back off. */
  Replaced: 4409,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];
