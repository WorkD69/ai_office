import {
  COLLECTOR_ONLINE_WINDOW_MS,
  CollectorMessage,
  deriveInbox,
  diffSnapshots,
  FEED_LIMIT,
  MAX_COLLECTOR_MESSAGE_BYTES,
  type FeedEvent,
  type OfficeState,
  type Snapshot,
} from '@ai-office/protocol';

/** Persistence port. The Durable Object backs it with its SQLite storage; tests use memory. */
export interface OfficeStore {
  loadSnapshot(): StoredSnapshot | null;
  saveSnapshot(value: StoredSnapshot): void;
  /** Newest first. */
  loadFeed(limit: number): FeedEvent[];
  /** Inserts events, ignoring ids that already exist; returns the events actually inserted. */
  appendFeed(events: FeedEvent[]): FeedEvent[];
  trimFeed(keep: number): void;
}

export interface StoredSnapshot {
  snapshot: Snapshot;
  savedAtMs: number;
  collectorLastSeenMs: number | null;
}

/**
 * Feed events included in each state message. The worker stores up to FEED_LIMIT events but sends
 * fewer, because the full state is re-sent on every change and phones are on mobile data.
 */
export const FEED_IN_STATE = Math.min(100, FEED_LIMIT);
/** An unchanged snapshot is re-persisted at most this often (free-tier write budget). */
export const SNAPSHOT_RESAVE_MS = 60_000;

export type CollectorResult =
  | { ok: true; stateChanged: boolean; newEvents: FeedEvent[] }
  | { ok: false; error: 'too_large' }
  /** `issues` holds schema paths only (never values), safe to log. */
  | { ok: false; error: 'invalid'; issues: string[] };

/**
 * Office business logic, independent of Cloudflare APIs so it can be unit-tested.
 * Holds the latest snapshot in memory and mirrors it to the store.
 */
export class OfficeCore {
  private snapshot: Snapshot | null;
  private savedAtMs: number;
  private collectorLastSeenMs: number | null;

  constructor(private readonly store: OfficeStore) {
    const stored = store.loadSnapshot();
    this.snapshot = stored?.snapshot ?? null;
    this.savedAtMs = stored?.savedAtMs ?? 0;
    this.collectorLastSeenMs = stored?.collectorLastSeenMs ?? null;
  }

  handleCollectorMessage(raw: string | ArrayBuffer, nowMs: number): CollectorResult {
    const bytes =
      typeof raw === 'string' ? new TextEncoder().encode(raw).byteLength : raw.byteLength;
    if (bytes > MAX_COLLECTOR_MESSAGE_BYTES) return { ok: false, error: 'too_large' };

    let json: unknown;
    try {
      json = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return { ok: false, error: 'invalid', issues: ['<not json>'] };
    }
    const parsed = CollectorMessage.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.code}`);
      return { ok: false, error: 'invalid', issues };
    }

    const wasOnline = this.isCollectorOnline(nowMs);
    this.collectorLastSeenMs = nowMs;
    const message = parsed.data;

    switch (message.type) {
      case 'heartbeat':
        // Coming back online is a visible state change; a routine heartbeat is not.
        return { ok: true, stateChanged: !wasOnline, newEvents: [] };

      case 'command_result': {
        const event: FeedEvent = {
          id: `cmd:${message.commandId}`,
          at: new Date(nowMs).toISOString(),
          agentId: null,
          level: message.ok ? 'info' : 'error',
          text: `Command ${message.ok ? 'completed' : 'failed'}: ${message.detail}`.slice(0, 240),
        };
        const newEvents = this.store.appendFeed([event]);
        this.store.trimFeed(FEED_LIMIT);
        return { ok: true, stateChanged: newEvents.length > 0, newEvents };
      }

      case 'snapshot': {
        const next = message.snapshot;
        const changed = this.snapshot === null || !sameContent(this.snapshot, next);
        const newEvents = this.store.appendFeed(diffSnapshots(this.snapshot, next));
        if (newEvents.length > 0) this.store.trimFeed(FEED_LIMIT);
        this.snapshot = next;
        if (changed || nowMs - this.savedAtMs >= SNAPSHOT_RESAVE_MS) {
          this.store.saveSnapshot({ snapshot: next, savedAtMs: nowMs, collectorLastSeenMs: nowMs });
          this.savedAtMs = nowMs;
        }
        return { ok: true, stateChanged: changed || !wasOnline || newEvents.length > 0, newEvents };
      }
    }
  }

  isCollectorOnline(nowMs: number): boolean {
    return (
      this.collectorLastSeenMs !== null &&
      nowMs - this.collectorLastSeenMs <= COLLECTOR_ONLINE_WINDOW_MS
    );
  }

  /** Restores the last-seen time after hibernation (kept in the collector socket attachment). */
  restoreCollectorLastSeen(ms: number | null): void {
    if (ms !== null && (this.collectorLastSeenMs === null || ms > this.collectorLastSeenMs)) {
      this.collectorLastSeenMs = ms;
    }
  }

  getState(nowMs: number): OfficeState {
    return {
      snapshot: this.snapshot,
      feed: this.store.loadFeed(FEED_IN_STATE),
      inbox: deriveInbox(this.snapshot),
      collectorOnline: this.isCollectorOnline(nowMs),
      collectorLastSeenAt:
        this.collectorLastSeenMs === null ? null : new Date(this.collectorLastSeenMs).toISOString(),
    };
  }
}

/** A viewer socket must be closed once the session it was opened with has expired. */
export function isSessionExpired(sessionExpMs: number | null, nowMs: number): boolean {
  return sessionExpMs === null || sessionExpMs <= nowMs;
}

/**
 * Two snapshots are "the same" if they differ only in fields that change on every export without
 * meaning anything to the viewer: the generation timestamp, the quota observation timestamp and
 * sub-threshold host-metric noise. Host metrics are quantised exactly like the collector does.
 */
export function sameContent(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

function normalise(s: Snapshot): Snapshot {
  return {
    ...s,
    generatedAt: '',
    quota: s.quota ? { ...s.quota, observedAt: '' } : null,
    host: s.host
      ? {
          ...s.host,
          memUsedMb: Math.round(s.host.memUsedMb / 32) * 32,
          load1: Math.round(s.host.load1 / 0.25) * 0.25,
          diskUsedPercent: Math.round(s.host.diskUsedPercent),
        }
      : null,
  };
}
