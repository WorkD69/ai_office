import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, tokenFromSubprotocol } from '../src/app.js';
import { createSession } from '../src/auth/session.js';
import type { Env } from '../src/env.js';
import { BOT_TOKEN, OWNER_ID, initDataFor, nowSeconds } from './helpers.js';

const SESSION_SECRET = 'unit-test-session-secret-0123456789';
const COLLECTOR_TOKEN = 'collector-token-0123456789abcdef0123456789';

/** Records what the Worker forwards to the Durable Object instead of upgrading. */
function makeEnv() {
  const forwarded: Request[] = [];
  const stub = {
    fetch: async (req: Request) => {
      forwarded.push(req);
      return new Response(`forwarded as ${req.headers.get('X-Office-Role')}`);
    },
  };
  const env = {
    OFFICE: { idFromName: () => ({}), get: () => stub },
    ASSETS: {},
    BOT_TOKEN,
    OWNER_TELEGRAM_ID: String(OWNER_ID),
    COLLECTOR_TOKEN,
    SESSION_SECRET,
  } as unknown as Env;
  return { env, forwarded };
}

const upgrade = { Upgrade: 'websocket' };

describe('HTTP API', () => {
  const app = createApp();
  let ctx: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    ctx = makeEnv();
  });

  const login = (initData: unknown) =>
    app.request(
      '/api/auth/telegram',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      },
      ctx.env,
    );

  it('serves a health check with no-store headers', async () => {
    const res = await app.request('/api/health', {}, ctx.env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('issues a session to the owner', async () => {
    const res = await login(initDataFor(OWNER_ID, nowSeconds()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; role: string };
    expect(body.role).toBe('owner');
    expect(body.token.split('.')).toHaveLength(2);
  });

  it('returns 403 for a valid Telegram user who is not the owner', async () => {
    expect((await login(initDataFor(OWNER_ID + 1, nowSeconds()))).status).toBe(403);
  });

  it('returns machine-readable error codes for each login failure', async () => {
    const expectError = async (res: Response, status: number, error: string) => {
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error });
    };
    await expectError(
      await login(initDataFor(OWNER_ID, nowSeconds(), '1:other')),
      401,
      'invalid_signature',
    );
    await expectError(
      await login(initDataFor(OWNER_ID, nowSeconds() - 2 * 3600)),
      401,
      'init_data_expired',
    );
    await expectError(await login(initDataFor(OWNER_ID + 1, nowSeconds())), 403, 'not_owner');
    await expectError(await login(42), 400, 'bad_request');
    await expectError(await login('hash=zzz'), 400, 'bad_request');
  });

  it('limits the auth request body size', async () => {
    const res = await app.request(
      '/api/auth/telegram',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(20_000) },
      ctx.env,
    );
    expect(res.status).toBe(413);
  });

  it('requires an upgrade on WebSocket routes', async () => {
    expect((await app.request('/api/ws', {}, ctx.env)).status).toBe(426);
    expect((await app.request('/api/collector', {}, ctx.env)).status).toBe(426);
  });

  it('rejects viewer sockets without a valid session', async () => {
    const res = await app.request(
      '/api/ws',
      { headers: { ...upgrade, 'Sec-WebSocket-Protocol': 'ai-office, nope' } },
      ctx.env,
    );
    expect(res.status).toBe(401);
    expect(ctx.forwarded).toHaveLength(0);
  });

  it('forwards an authenticated viewer with a server-assigned role', async () => {
    const { token } = await createSession(SESSION_SECRET, { sub: String(OWNER_ID), role: 'owner' });
    const res = await app.request(
      '/api/ws',
      // A client-supplied role header must be ignored.
      {
        headers: {
          ...upgrade,
          'Sec-WebSocket-Protocol': `ai-office, ${token}`,
          'X-Office-Role': 'collector',
        },
      },
      ctx.env,
    );
    expect(await res.text()).toBe('forwarded as owner');
  });

  it('does not accept the session token in the URL', async () => {
    const { token } = await createSession(SESSION_SECRET, { sub: String(OWNER_ID), role: 'owner' });
    const res = await app.request(`/api/ws?token=${token}`, { headers: upgrade }, ctx.env);
    expect(res.status).toBe(401);
    expect(ctx.forwarded).toHaveLength(0);
  });

  it('passes the session expiry to the Durable Object and ignores client-supplied values', async () => {
    const { token, payload } = await createSession(SESSION_SECRET, {
      sub: String(OWNER_ID),
      role: 'owner',
    });
    await app.request(
      '/api/ws?x=1',
      {
        headers: {
          ...upgrade,
          'Sec-WebSocket-Protocol': `ai-office, ${token}`,
          'X-Office-Session-Exp': '99999999999999',
        },
      },
      ctx.env,
    );
    const forwarded = ctx.forwarded[0]!;
    expect(forwarded.headers.get('X-Office-Session-Exp')).toBe(String(payload.exp * 1000));
    expect(new URL(forwarded.url).search).toBe('');
  });

  it('rejects sessions of another user or a reserved viewer role', async () => {
    for (const claims of [
      { sub: String(OWNER_ID + 1), role: 'owner' as const },
      { sub: String(OWNER_ID), role: 'viewer' as const },
    ]) {
      const { token } = await createSession(SESSION_SECRET, claims);
      const res = await app.request(
        '/api/ws',
        { headers: { ...upgrade, 'Sec-WebSocket-Protocol': `ai-office, ${token}` } },
        ctx.env,
      );
      expect(res.status).toBe(401);
    }
    expect(ctx.forwarded).toHaveLength(0);
  });

  it('reports session validity on /api/session', async () => {
    const { token, payload } = await createSession(SESSION_SECRET, {
      sub: String(OWNER_ID),
      role: 'owner',
    });
    const ok = await app.request(
      '/api/session',
      { headers: { Authorization: `Bearer ${token}` } },
      ctx.env,
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ expiresAt: new Date(payload.exp * 1000).toISOString() });

    const expired = await createSession(
      SESSION_SECRET,
      { sub: String(OWNER_ID), role: 'owner' },
      nowSeconds() - 100,
      10,
    );
    const cases: Record<string, string>[] = [{ Authorization: `Bearer ${expired.token}` }, {}];
    for (const headers of cases) {
      const res = await app.request('/api/session', { headers }, ctx.env);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_session' });
    }
  });

  it('authenticates the collector by bearer token', async () => {
    const bad = await app.request(
      '/api/collector',
      { headers: { ...upgrade, Authorization: 'Bearer wrong' } },
      ctx.env,
    );
    expect(bad.status).toBe(401);
    const good = await app.request(
      '/api/collector',
      { headers: { ...upgrade, Authorization: `Bearer ${COLLECTOR_TOKEN}` } },
      ctx.env,
    );
    expect(await good.text()).toBe('forwarded as collector');
    expect(ctx.forwarded[0]!.headers.get('Authorization')).toBeNull();
  });

  it('answers unknown API routes with JSON 404', async () => {
    const res = await app.request('/api/nope', {}, ctx.env);
    expect(res.status).toBe(404);
  });

  it('reports 503 when secrets are missing or too short', async () => {
    const post = (env: Env) =>
      app.request(
        '/api/auth/telegram',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        env,
      );
    const noBot = await post({ ...ctx.env, BOT_TOKEN: '' } as Env);
    expect(noBot.status).toBe(503);
    expect(await noBot.json()).toEqual({ error: 'not_configured' });
    expect((await post({ ...ctx.env, SESSION_SECRET: 'short' } as Env)).status).toBe(503);

    const collector = await app.request(
      '/api/collector',
      { headers: { ...upgrade, Authorization: 'Bearer short' } },
      { ...ctx.env, COLLECTOR_TOKEN: 'short' } as Env,
    );
    expect(collector.status).toBe(503);
    expect(ctx.forwarded).toHaveLength(0);
  });
});

describe('tokenFromSubprotocol', () => {
  it('extracts the token only after the ai-office marker', () => {
    expect(tokenFromSubprotocol('ai-office, abc.def')).toBe('abc.def');
    expect(tokenFromSubprotocol('abc.def')).toBeUndefined();
    expect(tokenFromSubprotocol('ai-office')).toBeUndefined();
    expect(tokenFromSubprotocol(undefined)).toBeUndefined();
  });
});
