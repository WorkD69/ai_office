import { WS_SUBPROTOCOL } from '@ai-office/protocol';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createSession, verifySession, type SessionPayload } from './auth/session.js';
import { validateInitData } from './auth/telegram.js';
import { timingSafeEqualStrings } from './crypto.js';
import type { Env } from './env.js';
import { ROLE_HEADER, SESSION_EXP_HEADER } from './headers.js';

/** Name of the single Durable Object instance that holds the office. */
const OFFICE_NAME = 'office';

/** Secrets shorter than this are treated as "not configured" (they would be guessable). */
export const MIN_SECRET_LENGTH = 32;

/**
 * JSON error codes returned by the API. The web client branches on these, so they are part of
 * the public contract (see README).
 */
export type ApiError =
  | 'bad_request'
  | 'init_data_expired'
  | 'invalid_signature'
  | 'not_owner'
  | 'payload_too_large'
  | 'not_configured'
  | 'invalid_session'
  | 'unauthorized'
  | 'upgrade_required'
  | 'not_found'
  | 'internal';

type AppEnv = { Bindings: Env };

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Plain JSON API responses: never cached, never sniffed. (Not applied to 101 upgrades.)
  const secureHeaders = async (c: Context<AppEnv>, next: () => Promise<void>) => {
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
  };
  const fail = (
    c: Context<AppEnv>,
    error: ApiError,
    status: 400 | 401 | 403 | 404 | 413 | 426 | 500 | 503,
  ) => c.json({ error }, status);

  app.get('/api/health', secureHeaders, (c) => c.json({ ok: true }));

  app.post(
    '/api/auth/telegram',
    secureHeaders,
    bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
    async (c) => {
      const { BOT_TOKEN, OWNER_TELEGRAM_ID, SESSION_SECRET } = c.env;
      if (!BOT_TOKEN || !ownerId(c.env) || !secretOk('SESSION_SECRET', SESSION_SECRET)) {
        return fail(c, 'not_configured', 503);
      }

      const body = await c.req.json<unknown>().catch(() => null);
      const initData = (body as { initData?: unknown } | null)?.initData;
      if (typeof initData !== 'string') return fail(c, 'bad_request', 400);

      const result = await validateInitData(initData, BOT_TOKEN);
      if (!result.ok) {
        if (result.reason === 'malformed') return fail(c, 'bad_request', 400);
        return fail(
          c,
          result.reason === 'expired' ? 'init_data_expired' : 'invalid_signature',
          401,
        );
      }
      if (String(result.user.id) !== OWNER_TELEGRAM_ID.trim()) return fail(c, 'not_owner', 403);

      const { token, payload } = await createSession(SESSION_SECRET, {
        sub: String(result.user.id),
        role: 'owner',
      });
      return c.json({ token, expiresAt: expiresAt(payload), role: payload.role });
    },
  );

  // Lets the client tell "my session expired" from "the network dropped": a rejected WebSocket
  // upgrade is indistinguishable from a network failure in the browser.
  app.get('/api/session', secureHeaders, async (c) => {
    if (!secretOk('SESSION_SECRET', c.env.SESSION_SECRET) || !ownerId(c.env)) {
      return fail(c, 'not_configured', 503);
    }
    const session = await authorizeSession(c.env, bearer(c.req.header('Authorization')));
    if (!session) return fail(c, 'invalid_session', 401);
    return c.json({ expiresAt: expiresAt(session) });
  });

  // Browser WebSocket. The token travels only in the subprotocol list (`ai-office, <token>`),
  // never in the URL, so it cannot end up in request logs.
  app.get('/api/ws', async (c) => {
    if (!isUpgrade(c)) return fail(c, 'upgrade_required', 426);
    if (!secretOk('SESSION_SECRET', c.env.SESSION_SECRET) || !ownerId(c.env)) {
      return fail(c, 'not_configured', 503);
    }

    const session = await authorizeSession(
      c.env,
      tokenFromSubprotocol(c.req.header('Sec-WebSocket-Protocol')),
    );
    if (!session) return fail(c, 'unauthorized', 401);

    return forwardToOffice(c, session.role, session.exp * 1000);
  });

  // Collector WebSocket (VPS -> Cloudflare, outbound only on the VPS side).
  app.get('/api/collector', async (c) => {
    if (!isUpgrade(c)) return fail(c, 'upgrade_required', 426);
    if (!secretOk('COLLECTOR_TOKEN', c.env.COLLECTOR_TOKEN)) return fail(c, 'not_configured', 503);

    const given = bearer(c.req.header('Authorization'));
    if (!given || !timingSafeEqualStrings(given, c.env.COLLECTOR_TOKEN)) {
      return fail(c, 'unauthorized', 401);
    }
    return forwardToOffice(c, 'collector', null);
  });

  app.all('/api/*', secureHeaders, (c) => fail(c, 'not_found', 404));

  app.onError((err, c) => {
    console.error('unhandled error', err instanceof Error ? err.message : 'unknown');
    return fail(c, 'internal', 500);
  });

  return app;
}

/**
 * A session is accepted only if its signature and expiry are valid AND it belongs to the current
 * owner: changing OWNER_TELEGRAM_ID revokes old sessions. `viewer` tokens are reserved for future
 * read-only share links and are not accepted yet.
 */
async function authorizeSession(
  env: Env,
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const session = await verifySession(env.SESSION_SECRET, token);
  if (!session || session.role !== 'owner' || session.sub !== ownerId(env)) return null;
  return session;
}

function ownerId(env: Env): string {
  return (env.OWNER_TELEGRAM_ID ?? '').trim();
}

/** Logs the name (never the value) of a missing or too-short secret. */
function secretOk(name: string, value: string | undefined): value is string {
  if (value && value.length >= MIN_SECRET_LENGTH) return true;
  console.error(`not configured: ${name} is missing or shorter than ${MIN_SECRET_LENGTH} chars`);
  return false;
}

function bearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}

function expiresAt(payload: SessionPayload): string {
  return new Date(payload.exp * 1000).toISOString();
}

function isUpgrade(c: Context<AppEnv>): boolean {
  return c.req.header('Upgrade')?.toLowerCase() === 'websocket';
}

export function tokenFromSubprotocol(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const parts = header
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts[0] !== WS_SUBPROTOCOL || parts.length < 2) return undefined;
  return parts[1];
}

/**
 * Forwards the upgrade to the Durable Object. The role and session-expiry headers are set here,
 * by the Worker, after authentication; client-supplied values are always overwritten.
 */
function forwardToOffice(
  c: Context<AppEnv>,
  role: 'owner' | 'viewer' | 'collector',
  sessionExpMs: number | null,
): Promise<Response> {
  const headers = new Headers(c.req.raw.headers);
  headers.set(ROLE_HEADER, role);
  headers.delete(SESSION_EXP_HEADER);
  if (sessionExpMs !== null) headers.set(SESSION_EXP_HEADER, String(sessionExpMs));
  headers.delete('Authorization');
  headers.delete('Cookie');
  const url = new URL(c.req.url);
  url.search = '';

  const stub = c.env.OFFICE.get(c.env.OFFICE.idFromName(OFFICE_NAME));
  return stub.fetch(new Request(url.toString(), { method: 'GET', headers }));
}
