/**
 * Live connection: Telegram initData -> short-lived session token -> WebSocket.
 *
 * The token travels as a WebSocket subprotocol because browsers cannot set headers on a
 * WebSocket. A rejected upgrade (HTTP 401) is invisible to the browser: the socket simply
 * closes before `open`. So after such a close we ask `GET /api/session` whether the token is
 * still valid, to tell an expired session (re-authenticate) from a network problem (retry).
 *
 * Every Cloudflare/browser dependency is injectable, which keeps the state machine unit-testable.
 */
import {
  CloseCode,
  ServerMessage,
  WS_SUBPROTOCOL,
  type FeedEvent,
  type OfficeState,
} from '@ai-office/protocol';

/** Terminal states: retrying would not help, so the UI shows an explanation instead. */
export type DeniedConnection = 'expired' | 'not_owner' | 'not_configured' | 'unauthorized';
export type Connection = 'demo' | 'connecting' | 'online' | 'reconnecting' | DeniedConnection;

export const DENIED: ReadonlySet<Connection> = new Set<Connection>([
  'expired',
  'not_owner',
  'not_configured',
  'unauthorized',
]);

export interface LiveHandlers {
  onState(state: OfficeState): void;
  onEvent(event: FeedEvent): void;
  onConnection(connection: Connection): void;
}

/** The subset of the browser WebSocket the client relies on. */
export interface SocketLike {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent<string>) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  close(code?: number, reason?: string): void;
}

export interface LiveDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  createSocket: (url: string, protocols: string[]) => SocketLike;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  random: () => number;
  wsUrl: string;
}

export function browserDeps(): LiveDeps {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return {
    fetch: (input, init) => window.fetch(input, init),
    createSocket: (url, protocols) => new WebSocket(url, protocols),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    random: Math.random,
    wsUrl: `${scheme}://${window.location.host}/api/ws`,
  };
}

/** Exponential backoff with "equal jitter": 1s, 2s, 4s … capped at 30s. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
  return Math.round(base / 2 + (random() * base) / 2);
}

export type AuthResult =
  { kind: 'ok'; token: string } | { kind: 'denied'; reason: DeniedConnection } | { kind: 'retry' };

async function errorCode(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    const error = (body as { error?: unknown } | null)?.error;
    return typeof error === 'string' ? error : null;
  } catch {
    return null;
  }
}

/** Exchanges Telegram initData for a session token (see apps/worker README for the contract). */
export async function authenticate(deps: LiveDeps, initData: string): Promise<AuthResult> {
  let res: Response;
  try {
    res = await deps.fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
  } catch {
    return { kind: 'retry' };
  }
  if (res.ok) {
    try {
      const token = ((await res.json()) as { token?: unknown } | null)?.token;
      return typeof token === 'string' && token.length > 0
        ? { kind: 'ok', token }
        : { kind: 'retry' };
    } catch {
      return { kind: 'retry' };
    }
  }
  const code = await errorCode(res);
  if (res.status === 401) {
    return { kind: 'denied', reason: code === 'init_data_expired' ? 'expired' : 'unauthorized' };
  }
  if (res.status === 403) return { kind: 'denied', reason: 'not_owner' };
  if (res.status === 503 && code === 'not_configured') {
    return { kind: 'denied', reason: 'not_configured' };
  }
  // 400/413: our initData is malformed; asking again with the same data cannot succeed.
  if (res.status === 400 || res.status === 413) return { kind: 'denied', reason: 'unauthorized' };
  return { kind: 'retry' };
}

export type SessionCheck = 'valid' | 'invalid' | 'unknown';

/** Is the token still accepted? `unknown` means "could not tell" (network or server trouble). */
export async function checkSession(deps: LiveDeps, token: string): Promise<SessionCheck> {
  try {
    const res = await deps.fetch('/api/session', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) return 'valid';
    if (res.status === 401) return 'invalid';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Starts the connection loop; returns a disposer. */
export function connectLive(
  initData: string,
  handlers: LiveHandlers,
  deps: LiveDeps = browserDeps(),
): () => void {
  let stopped = false;
  let socket: SocketLike | null = null;
  let token: string | null = null;
  let attempt = 0;
  let timer: unknown;

  const retry = () => {
    if (stopped) return;
    handlers.onConnection('reconnecting');
    timer = deps.setTimeout(() => void run(), backoffDelay(attempt++, deps.random));
  };

  const deny = (reason: DeniedConnection) => {
    token = null;
    handlers.onConnection(reason);
  };

  async function run(): Promise<void> {
    if (stopped) return;
    if (!token) {
      const auth = await authenticate(deps, initData);
      if (stopped) return;
      if (auth.kind === 'denied') return deny(auth.reason);
      if (auth.kind === 'retry') return retry();
      token = auth.token;
    }

    const ws = deps.createSocket(deps.wsUrl, [WS_SUBPROTOCOL, token]);
    socket = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      attempt = 0;
      handlers.onConnection('online');
    };
    ws.onmessage = (ev) => {
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch {
        return;
      }
      const parsed = ServerMessage.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.type === 'state') handlers.onState(parsed.data.state);
      else handlers.onEvent(parsed.data.event);
    };
    ws.onclose = (ev) => {
      if (stopped || socket !== ws) return;
      socket = null;
      void onClosed(ev.code, opened);
    };
  }

  async function onClosed(code: number, opened: boolean): Promise<void> {
    if (code === CloseCode.SessionExpired) {
      token = null;
    } else if (!opened && token) {
      // The upgrade was rejected or the network failed; find out which.
      const check = await checkSession(deps, token);
      if (stopped) return;
      if (check === 'invalid') token = null;
    }
    retry();
  }

  handlers.onConnection('connecting');
  void run();

  return () => {
    stopped = true;
    if (timer !== undefined) deps.clearTimeout(timer);
    socket?.close(1000, 'bye');
  };
}
