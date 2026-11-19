import { DurableObject } from 'cloudflare:workers';
import { CloseCode, WS_SUBPROTOCOL, type FeedEvent, type ServerMessage } from '@ai-office/protocol';
import { ROLE_HEADER, SESSION_EXP_HEADER } from './headers.js';
import { isSessionExpired, OfficeCore, type OfficeStore, type StoredSnapshot } from './core.js';
import type { Env } from './env.js';

type SocketRole = 'collector' | 'viewer';

interface Attachment {
  role: SocketRole;
  /** Consecutive invalid messages from this socket. */
  strikes: number;
  lastSeenMs: number | null;
  /** Viewers only: expiry of the session the socket was opened with (epoch ms). */
  sessionExpMs: number | null;
}

const MAX_STRIKES = 3;

/**
 * The single office instance. Uses the WebSocket Hibernation API, so an idle office costs
 * nothing: no timers, all per-socket state lives in socket attachments, the rest in SQLite.
 * Viewer session expiry is therefore enforced lazily, on every broadcast and viewer message.
 */
export class Office extends DurableObject<Env> {
  private readonly core: OfficeCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new OfficeCore(this.createStore(ctx));
    for (const ws of ctx.getWebSockets('collector')) {
      this.core.restoreCollectorLastSeen(attachmentOf(ws)?.lastSeenMs ?? null);
    }
  }

  /** Persistence factory; tests override it with an in-memory store. */
  protected createStore(ctx: DurableObjectState): OfficeStore {
    return new SqlOfficeStore(ctx.storage.sql);
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const roleHeader = request.headers.get(ROLE_HEADER);
    const role: SocketRole | null =
      roleHeader === 'collector'
        ? 'collector'
        : roleHeader === 'owner' || roleHeader === 'viewer'
          ? 'viewer'
          : null;
    if (!role) return new Response('Forbidden', { status: 403 });

    let sessionExpMs: number | null = null;
    if (role === 'viewer') {
      sessionExpMs = Number(request.headers.get(SESSION_EXP_HEADER));
      if (!Number.isFinite(sessionExpMs) || isSessionExpired(sessionExpMs, Date.now())) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.acceptSocket(server, role, sessionExpMs);

    const headers = new Headers();
    const offered = request.headers.get('Sec-WebSocket-Protocol')?.split(',') ?? [];
    if (offered.some((p) => p.trim() === WS_SUBPROTOCOL)) {
      headers.set('Sec-WebSocket-Protocol', WS_SUBPROTOCOL);
    }
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  /**
   * Registers an accepted server-side socket. Split from `fetch` so it can be tested without the
   * runtime-only `WebSocketPair` / status-101 `Response`.
   * @internal
   */
  acceptSocket(server: WebSocket, role: SocketRole, sessionExpMs: number | null): void {
    if (role === 'collector') {
      // The newest collector wins: a reconnect (or a second holder of the token) replaces the
      // old socket. The close code tells the replaced relay to back off instead of reconnecting.
      for (const old of this.ctx.getWebSockets('collector')) {
        safeClose(old, CloseCode.Replaced, 'replaced by a newer collector connection');
      }
    }

    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({
      role,
      strikes: 0,
      lastSeenMs: null,
      sessionExpMs,
    } satisfies Attachment);

    if (role === 'viewer') {
      this.closeExpiredViewers(Date.now());
      server.send(JSON.stringify(this.stateMessage()));
    }
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = attachmentOf(ws);
    if (!attachment) return;
    const now = Date.now();

    // Viewers are read-only in this phase: their messages have no execution path at all.
    // A message is still a good moment to enforce session expiry.
    if (attachment.role !== 'collector') {
      if (isSessionExpired(attachment.sessionExpMs, now)) {
        safeClose(ws, CloseCode.SessionExpired, 'session expired');
      }
      return;
    }

    const result = this.core.handleCollectorMessage(message, now);
    if (!result.ok) {
      if (result.error === 'too_large') {
        safeClose(ws, CloseCode.MessageTooBig, 'message too large');
        return;
      }
      // Paths and zod codes only, never values: snapshots may contain activity text.
      console.warn('collector message rejected', result.issues.join('; '));
      const strikes = attachment.strikes + 1;
      ws.serializeAttachment({ ...attachment, strikes } satisfies Attachment);
      if (strikes >= MAX_STRIKES) safeClose(ws, CloseCode.PolicyViolation, 'invalid messages');
      return;
    }

    ws.serializeAttachment({ ...attachment, strikes: 0, lastSeenMs: now } satisfies Attachment);
    if (result.stateChanged) this.broadcast();
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    safeClose(ws, code, reason);
    if (attachmentOf(ws)?.role === 'collector') this.broadcast(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    if (attachmentOf(ws)?.role === 'collector') this.broadcast(ws);
  }

  private stateMessage(closing?: WebSocket): ServerMessage {
    const state = this.core.getState(Date.now());
    const collectorConnected = this.ctx.getWebSockets('collector').some((ws) => ws !== closing);
    return {
      type: 'state',
      state: { ...state, collectorOnline: state.collectorOnline && collectorConnected },
    };
  }

  /**
   * Sends the full state to every live viewer. New feed events are already part of the state,
   * so separate `event` messages are not sent (the protocol keeps the type for future use).
   */
  private broadcast(closing?: WebSocket): void {
    const now = Date.now();
    const viewers = this.closeExpiredViewers(now);
    if (viewers.length === 0) return;
    const payload = JSON.stringify(this.stateMessage(closing));
    for (const ws of viewers) {
      try {
        ws.send(payload);
      } catch {
        /* the runtime will deliver a close event */
      }
    }
  }

  /** Closes viewer sockets whose session has expired; returns the ones still valid. */
  private closeExpiredViewers(nowMs: number): WebSocket[] {
    const alive: WebSocket[] = [];
    for (const ws of this.ctx.getWebSockets('viewer')) {
      if (isSessionExpired(attachmentOf(ws)?.sessionExpMs ?? null, nowMs)) {
        safeClose(ws, CloseCode.SessionExpired, 'session expired');
      } else {
        alive.push(ws);
      }
    }
    return alive;
  }
}

function attachmentOf(ws: WebSocket): Attachment | null {
  return (ws.deserializeAttachment() as Attachment | null) ?? null;
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    /* already closed */
  }
}

/** OfficeStore backed by the Durable Object's synchronous SQLite API. */
class SqlOfficeStore implements OfficeStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS feed (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         id TEXT NOT NULL UNIQUE,
         json TEXT NOT NULL
       )`,
    );
  }

  loadSnapshot(): StoredSnapshot | null {
    const row = this.sql
      .exec<{ value: string }>(`SELECT value FROM kv WHERE key = 'snapshot'`)
      .toArray()[0];
    return row ? (JSON.parse(row.value) as StoredSnapshot) : null;
  }

  saveSnapshot(value: StoredSnapshot): void {
    this.sql.exec(
      `INSERT INTO kv (key, value) VALUES ('snapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(value),
    );
  }

  loadFeed(limit: number): FeedEvent[] {
    return this.sql
      .exec<{ json: string }>(`SELECT json FROM feed ORDER BY seq DESC LIMIT ?`, limit)
      .toArray()
      .map((row) => JSON.parse(row.json) as FeedEvent);
  }

  appendFeed(events: FeedEvent[]): FeedEvent[] {
    const inserted: FeedEvent[] = [];
    for (const event of events) {
      const cursor = this.sql.exec(
        `INSERT OR IGNORE INTO feed (id, json) VALUES (?, ?)`,
        event.id,
        JSON.stringify(event),
      );
      if (cursor.rowsWritten > 0) inserted.push(event);
    }
    return inserted;
  }

  trimFeed(keep: number): void {
    this.sql.exec(`DELETE FROM feed WHERE seq <= (SELECT MAX(seq) FROM feed) - ?`, keep);
  }
}
