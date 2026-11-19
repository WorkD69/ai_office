import { describe, expect, it } from 'vitest';
import { CloseCode, WS_SUBPROTOCOL, type OfficeState } from '@ai-office/protocol';
import { connectLive, type Connection, type LiveDeps, type SocketLike } from '../src/data/live';

type Reply = { status: number; body?: unknown } | 'network-error';

class FakeSocket implements SocketLike {
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent<string>) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  closedByClient = false;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}
  open() {
    this.onopen?.({} as Event);
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  serverClose(code: number) {
    this.onclose?.({ code } as CloseEvent);
  }
  close() {
    this.closedByClient = true;
  }
}

/** A scripted environment: queued HTTP replies per path, captured sockets, manual timers. */
function harness(replies: Record<string, Reply[]>) {
  const calls: Array<{ path: string; auth: string | null }> = [];
  const sockets: FakeSocket[] = [];
  const timers: Array<() => void> = [];
  const connections: Connection[] = [];
  const states: OfficeState[] = [];

  const deps: LiveDeps = {
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ path: input, auth: headers.get('authorization') });
      const reply = replies[input]?.shift();
      if (!reply) throw new Error(`unexpected request to ${input}`);
      if (reply === 'network-error') throw new TypeError('Failed to fetch');
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status,
      });
    },
    createSocket: (url, protocols) => {
      const s = new FakeSocket(url, protocols);
      sockets.push(s);
      return s;
    },
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
    random: () => 0,
    wsUrl: 'wss://office.test/api/ws',
  };

  const stop = connectLive(
    'query_id=1&hash=abc',
    {
      onState: (s) => states.push(s),
      onEvent: () => {},
      onConnection: (c) => connections.push(c),
    },
    deps,
  );

  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** Fires the next scheduled retry and lets the async work settle. */
  const fireTimer = async () => {
    const fn = timers.shift();
    if (!fn) throw new Error('no retry scheduled');
    fn();
    await flush();
  };
  return { calls, sockets, timers, connections, states, stop, flush, fireTimer };
}

const ok = (token: string): Reply => ({
  status: 200,
  body: { token, expiresAt: 'x', role: 'owner' },
});

describe('connectLive', () => {
  it('authenticates, opens the socket with the token as subprotocol and goes online', async () => {
    const h = harness({ '/api/auth/telegram': [ok('t1')] });
    await h.flush();
    expect(h.sockets[0]?.protocols).toEqual([WS_SUBPROTOCOL, 't1']);
    h.sockets[0]?.open();
    h.sockets[0]?.message({
      type: 'state',
      state: {
        snapshot: null,
        feed: [],
        inbox: [],
        collectorOnline: false,
        collectorLastSeenAt: null,
      },
    });
    expect(h.connections).toEqual(['connecting', 'online']);
    expect(h.states).toHaveLength(1);
  });

  it('keeps the token when the socket never opened but the session is still valid', async () => {
    const h = harness({
      '/api/auth/telegram': [ok('t1')],
      '/api/session': [{ status: 200, body: { expiresAt: 'x' } }],
    });
    await h.flush();
    h.sockets[0]?.serverClose(1006);
    await h.flush();
    expect(h.calls.map((c) => c.path)).toEqual(['/api/auth/telegram', '/api/session']);
    expect(h.calls[1]?.auth).toBe('Bearer t1');
    await h.fireTimer();
    // No new login: the same token is reused.
    expect(h.calls.filter((c) => c.path === '/api/auth/telegram')).toHaveLength(1);
    expect(h.sockets[1]?.protocols).toEqual([WS_SUBPROTOCOL, 't1']);
  });

  it('keeps the token and retries when the session check itself fails (network)', async () => {
    const h = harness({
      '/api/auth/telegram': [ok('t1')],
      '/api/session': ['network-error'],
    });
    await h.flush();
    h.sockets[0]?.serverClose(1006);
    await h.flush();
    await h.fireTimer();
    expect(h.sockets[1]?.protocols[1]).toBe('t1');
  });

  it('re-authenticates when the socket never opened because the session is invalid', async () => {
    const h = harness({
      '/api/auth/telegram': [ok('t1'), ok('t2')],
      '/api/session': [{ status: 401, body: { error: 'invalid_session' } }],
    });
    await h.flush();
    h.sockets[0]?.serverClose(1006);
    await h.flush();
    await h.fireTimer();
    expect(h.sockets[1]?.protocols[1]).toBe('t2');
  });

  it('re-authenticates after the server closes an open socket with SessionExpired', async () => {
    const h = harness({ '/api/auth/telegram': [ok('t1'), ok('t2')] });
    await h.flush();
    h.sockets[0]?.open();
    h.sockets[0]?.serverClose(CloseCode.SessionExpired);
    await h.flush();
    expect(h.calls).toHaveLength(1); // no session probe needed: the code says it all
    await h.fireTimer();
    expect(h.sockets[1]?.protocols[1]).toBe('t2');
    expect(h.connections).toContain('reconnecting');
  });

  it('stops with a distinct state when initData has expired, without a retry loop', async () => {
    const h = harness({
      '/api/auth/telegram': [{ status: 401, body: { error: 'init_data_expired' } }],
    });
    await h.flush();
    expect(h.connections.at(-1)).toBe('expired');
    expect(h.timers).toHaveLength(0);
    expect(h.sockets).toHaveLength(0);
  });

  it.each([
    [{ status: 403, body: { error: 'not_owner' } }, 'not_owner'],
    [{ status: 503, body: { error: 'not_configured' } }, 'not_configured'],
    [{ status: 401, body: { error: 'invalid_signature' } }, 'unauthorized'],
    [{ status: 400, body: { error: 'bad_request' } }, 'unauthorized'],
  ] as const)('maps a %o denial to a terminal state', async (reply, expected) => {
    const h = harness({ '/api/auth/telegram': [reply] });
    await h.flush();
    expect(h.connections.at(-1)).toBe(expected);
    expect(h.timers).toHaveLength(0);
  });

  it('retries with backoff on server errors and network failures during login', async () => {
    const h = harness({
      '/api/auth/telegram': [{ status: 502 }, 'network-error', ok('t1')],
    });
    await h.flush();
    expect(h.connections.at(-1)).toBe('reconnecting');
    await h.fireTimer();
    await h.fireTimer();
    expect(h.sockets[0]?.protocols[1]).toBe('t1');
  });

  it('closes the socket and schedules nothing after dispose', async () => {
    const h = harness({ '/api/auth/telegram': [ok('t1')] });
    await h.flush();
    h.stop();
    expect(h.sockets[0]?.closedByClient).toBe(true);
    h.sockets[0]?.serverClose(1006);
    await h.flush();
    expect(h.timers).toHaveLength(0);
  });
});
