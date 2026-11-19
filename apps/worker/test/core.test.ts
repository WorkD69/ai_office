import { describe, expect, it } from 'vitest';
import {
  COLLECTOR_ONLINE_WINDOW_MS,
  MAX_COLLECTOR_MESSAGE_BYTES,
  type Agent,
  type Host,
  type Quota,
  type Snapshot,
} from '@ai-office/protocol';
import { isSessionExpired, OfficeCore, sameContent, SNAPSHOT_RESAVE_MS } from '../src/core.js';
import { MemoryOfficeStore } from './memory-store.js';

const T0 = Date.parse('2026-11-19T10:00:00.000Z');

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'coordinator',
    name: 'Coordinator',
    role: 'Main assistant',
    room: 'hq',
    kind: 'llm',
    status: 'idle',
    activity: null,
    lastActivityAt: null,
    model: null,
    usageToday: null,
    cron: [],
    ...over,
  };
}

function snap(agents: Agent[], atMs: number, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 1,
    generatedAt: new Date(atMs).toISOString(),
    agents,
    quota: null,
    host: null,
    ...extra,
  };
}

function snapshotMsg(agents: Agent[], atMs: number, extra: Partial<Snapshot> = {}): string {
  return JSON.stringify({ type: 'snapshot', snapshot: snap(agents, atMs, extra) });
}

const host = (over: Partial<Host> = {}): Host => ({
  memUsedMb: 1090,
  memTotalMb: 1967,
  diskUsedPercent: 73.2,
  load1: 0.07,
  services: [{ name: 'docker.service', active: true }],
  ...over,
});

const quota = (usedPercent: number, observedAtMs: number): Quota => ({
  provider: 'openai-codex',
  windows: [{ name: '5h', usedPercent, resetsAt: null }],
  observedAt: new Date(observedAtMs).toISOString(),
});

describe('OfficeCore', () => {
  it('turns snapshots into state, feed events and inbox items', () => {
    const core = new OfficeCore(new MemoryOfficeStore());
    expect(core.handleCollectorMessage(snapshotMsg([agent()], T0), T0)).toMatchObject({
      ok: true,
      stateChanged: true,
    });

    const result = core.handleCollectorMessage(
      snapshotMsg([agent({ status: 'waiting_you', activity: 'approve shell command' })], T0 + 5000),
      T0 + 5000,
    );
    expect(result).toMatchObject({ ok: true, stateChanged: true });
    expect(result.ok && result.newEvents.map((e) => e.text)).toEqual([
      'Coordinator is waiting for you',
    ]);

    const state = core.getState(T0 + 6000);
    expect(state.collectorOnline).toBe(true);
    expect(state.snapshot?.agents[0]?.status).toBe('waiting_you');
    expect(state.inbox.map((i) => i.kind)).toEqual(['approval']);
    expect(state.feed).toHaveLength(1);
  });

  it('does not duplicate feed events when a snapshot is replayed', () => {
    const store = new MemoryOfficeStore();
    const core = new OfficeCore(store);
    core.handleCollectorMessage(snapshotMsg([agent()], T0), T0);
    const changed = snapshotMsg([agent({ status: 'error' })], T0 + 1000);
    core.handleCollectorMessage(changed, T0 + 1000);
    // A fresh core (e.g. after eviction) sees the same message again.
    const revived = new OfficeCore(store);
    revived.handleCollectorMessage(snapshotMsg([agent()], T0), T0 + 2000);
    revived.handleCollectorMessage(changed, T0 + 3000);
    expect(revived.getState(T0 + 3000).feed.filter((e) => e.text.includes('error'))).toHaveLength(
      1,
    );
  });

  it('throttles storage writes for unchanged snapshots', () => {
    const store = new MemoryOfficeStore();
    const core = new OfficeCore(store);
    core.handleCollectorMessage(snapshotMsg([agent()], T0), T0);
    core.handleCollectorMessage(snapshotMsg([agent()], T0 + 10_000), T0 + 10_000);
    core.handleCollectorMessage(snapshotMsg([agent()], T0 + 20_000), T0 + 20_000);
    expect(store.saves).toBe(1);
    core.handleCollectorMessage(
      snapshotMsg([agent()], T0 + SNAPSHOT_RESAVE_MS),
      T0 + SNAPSHOT_RESAVE_MS,
    );
    expect(store.saves).toBe(2);
  });

  it('survives a restart from persisted state', () => {
    const store = new MemoryOfficeStore();
    new OfficeCore(store).handleCollectorMessage(
      snapshotMsg([agent({ status: 'working' })], T0),
      T0,
    );
    const revived = new OfficeCore(store);
    expect(revived.getState(T0 + 1000).snapshot?.agents[0]?.status).toBe('working');
  });

  it('rejects oversized and invalid messages without touching state', () => {
    const core = new OfficeCore(new MemoryOfficeStore());
    expect(core.handleCollectorMessage('x'.repeat(MAX_COLLECTOR_MESSAGE_BYTES + 1), T0)).toEqual({
      ok: false,
      error: 'too_large',
    });
    expect(core.handleCollectorMessage('not json', T0)).toMatchObject({
      ok: false,
      error: 'invalid',
    });
    expect(
      core.handleCollectorMessage(JSON.stringify({ type: 'exec', cmd: 'rm -rf /' }), T0),
    ).toMatchObject({ ok: false, error: 'invalid' });
    expect(
      core.handleCollectorMessage(JSON.stringify({ type: 'snapshot', snapshot: { v: 2 } }), T0),
    ).toMatchObject({ ok: false, error: 'invalid' });
    expect(core.getState(T0)).toMatchObject({ snapshot: null, collectorOnline: false, feed: [] });
  });

  it('tracks collector liveness through heartbeats', () => {
    const core = new OfficeCore(new MemoryOfficeStore());
    const hb = (ms: number) =>
      JSON.stringify({ type: 'heartbeat', at: new Date(ms).toISOString() });
    expect(core.handleCollectorMessage(hb(T0), T0)).toEqual({
      ok: true,
      stateChanged: true,
      newEvents: [],
    });
    expect(core.handleCollectorMessage(hb(T0 + 1000), T0 + 1000)).toEqual({
      ok: true,
      stateChanged: false,
      newEvents: [],
    });
    expect(core.getState(T0 + 1000 + COLLECTOR_ONLINE_WINDOW_MS).collectorOnline).toBe(true);
    expect(core.getState(T0 + 1001 + COLLECTOR_ONLINE_WINDOW_MS).collectorOnline).toBe(false);
  });

  it('records command results in the feed', () => {
    const core = new OfficeCore(new MemoryOfficeStore());
    const result = core.handleCollectorMessage(
      JSON.stringify({
        type: 'command_result',
        commandId: '6f1c2a5e-8f0b-4c55-9f43-3b0f0b6d2e11',
        ok: false,
        detail: 'cron job not found',
      }),
      T0,
    );
    expect(result.ok && result.newEvents[0]?.text).toBe('Command failed: cron job not found');
  });

  it('reports schema paths, never values, for invalid snapshots', () => {
    const core = new OfficeCore(new MemoryOfficeStore());
    const secret = 'sk-secret-value-that-must-not-be-logged';
    const bad = JSON.stringify({
      type: 'snapshot',
      snapshot: { ...snap([agent({ role: secret.repeat(5) })], T0) },
    });
    const result = core.handleCollectorMessage(bad, T0);
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== 'invalid') throw new Error('expected invalid');
    expect(result.issues).toEqual(['snapshot.agents.0.role: too_big']);
    expect(result.issues.join()).not.toContain('sk-secret');
  });

  it('ignores volatile host/quota noise when deciding whether to persist and broadcast', () => {
    const store = new MemoryOfficeStore();
    const core = new OfficeCore(store);
    core.handleCollectorMessage(
      snapshotMsg([agent()], T0, { host: host(), quota: quota(40, T0) }),
      T0,
    );
    const noisy = core.handleCollectorMessage(
      snapshotMsg([agent()], T0 + 5000, {
        host: host({ memUsedMb: 1100, load1: 0.1, diskUsedPercent: 73.4 }),
        quota: quota(40, T0 + 5000),
      }),
      T0 + 5000,
    );
    expect(noisy).toMatchObject({ ok: true, stateChanged: false });
    expect(store.saves).toBe(1);

    const real = core.handleCollectorMessage(
      snapshotMsg([agent()], T0 + 10_000, {
        host: host({ memUsedMb: 1300 }),
        quota: quota(41, T0 + 10_000),
      }),
      T0 + 10_000,
    );
    expect(real).toMatchObject({ ok: true, stateChanged: true });
    expect(store.saves).toBe(2);
  });

  it('treats a quota percentage change as real content', () => {
    expect(
      sameContent(
        snap([], T0, { quota: quota(40, T0) }),
        snap([], T0 + 1, { quota: quota(40, T0 + 1) }),
      ),
    ).toBe(true);
    expect(
      sameContent(snap([], T0, { quota: quota(40, T0) }), snap([], T0, { quota: quota(45, T0) })),
    ).toBe(false);
  });
});

describe('isSessionExpired', () => {
  it('expires at the exact expiry instant and when no expiry is known', () => {
    expect(isSessionExpired(T0 + 1, T0)).toBe(false);
    expect(isSessionExpired(T0, T0)).toBe(true);
    expect(isSessionExpired(null, T0)).toBe(true);
  });
});
