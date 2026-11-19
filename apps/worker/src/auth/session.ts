import { base64urlDecode, base64urlEncode, hmacSha256, timingSafeEqual, utf8 } from '../crypto.js';

/**
 * Compact signed session token: `<base64url(json payload)>.<base64url(hmac-sha256)>`.
 * Deliberately minimal (not a full JWT): one algorithm, one issuer, nothing to negotiate.
 */

/**
 * `owner` is the only role issued today. `viewer` is reserved for future read-only share links;
 * the HTTP layer currently rejects viewer tokens (see `authorizeSession` in app.ts).
 */
export type Role = 'owner' | 'viewer';

export interface SessionPayload {
  /** Telegram user id (as a string). */
  sub: string;
  role: Role;
  /** Expiry, unix seconds. */
  exp: number;
}

export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export async function createSession(
  secret: string,
  claims: { sub: string; role: Role },
  nowSeconds: number = Math.floor(Date.now() / 1000),
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<{ token: string; payload: SessionPayload }> {
  const payload: SessionPayload = {
    sub: claims.sub,
    role: claims.role,
    exp: nowSeconds + ttlSeconds,
  };
  const body = base64urlEncode(utf8(JSON.stringify(payload)));
  const signature = base64urlEncode(await hmacSha256(secret, body));
  return { token: `${body}.${signature}`, payload };
}

export async function verifySession(
  secret: string,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  if (!token || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];

  const given = base64urlDecode(signature);
  if (!given) return null;
  const expected = await hmacSha256(secret, body);
  if (!timingSafeEqual(expected, given)) return null;

  const raw = base64urlDecode(body);
  if (!raw) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!isPayload(payload) || payload.exp <= nowSeconds) return null;
  return payload;
}

function isPayload(value: unknown): value is SessionPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sub === 'string' &&
    (v.role === 'owner' || v.role === 'viewer') &&
    typeof v.exp === 'number' &&
    Number.isFinite(v.exp)
  );
}
