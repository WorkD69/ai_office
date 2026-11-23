import { describe, expect, it } from 'vitest';
import { SNAPSHOT_STALE_AFTER_MS, type FeedEvent, type OfficeState } from '@ai-office/protocol';
import { createDemoOffice, STALE_DEMO_AGE_MS } from '../src/data/demo';
import { sortFeed } from '../src/lib/feed';
import { freshness } from '../src/lib/freshness';
import { formatAge } from '../src/lib/time';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');

function state(generatedAt: string | null, collectorOnline = true): OfficeState {
  return {
    snapshot: generatedAt ? { v: 2, generatedAt, agents: [], quotas: [], host: null } : null,
    feed: [],
    inbox: [],
    collectorOnline,
    collectorLastSeenAt: null,
  };
}

describe('freshness', () => {
  it('is fresh for a recent snapshot from an online collector', () => {
    expect(freshness(state(new Date(NOW - 5_000).toISOString()), NOW)).toEqual({ kind: 'fresh' });
    expect(freshness(null, NOW)).toEqual({ kind: 'fresh' });
  });

  it('flags a snapshot older than the threshold even if the collector looks online', () => {
    const f = freshness(state(new Date(NOW - SNAPSHOT_STALE_AFTER_MS - 1).toISOString()), NOW);
    expect(f.kind).toBe('stale');
  });

  it('reports an offline collector with the data age when known', () => {
    expect(freshness(state(new Date(NOW - 120_000).toISOString(), false), NOW)).toEqual({
      kind: 'collector_offline',
      ageMs: 120_000,
    });
    expect(freshness(state(null, false), NOW)).toEqual({ kind: 'collector_offline', ageMs: null });
  });

  it('treats a non-UTC offset correctly', () => {
    // 15:00+03:00 is 12:00Z, i.e. exactly NOW.
    expect(freshness(state('2026-11-19T15:00:00.000+03:00'), NOW)).toEqual({ kind: 'fresh' });
  });
});

describe('sortFeed', () => {
  const ev = (id: string, at: string): FeedEvent => ({
    id,
    at,
    agentId: null,
    level: 'info',
    text: id,
  });

  it('sorts newest first by instant, not by string', () => {
    // As strings, "11:30+00:00" > "10:00-03:00", but 10:00-03:00 is 13:00Z, the newest.
    const sorted = sortFeed([
      ev('a', '2026-11-19T11:30:00.000+00:00'),
      ev('b', '2026-11-19T10:00:00.000-03:00'),
      ev('c', '2026-11-19T09:00:00.000Z'),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('caps the length', () => {
    const many = Array.from({ length: 10 }, (_, i) => ev(`e${i}`, new Date(NOW + i).toISOString()));
    expect(sortFeed(many, 3).map((e) => e.id)).toEqual(['e9', 'e8', 'e7']);
  });
});

describe('formatAge', () => {
  it('uses minutes below two hours and hours above', () => {
    expect(formatAge(30_000, 'en')).toBe('1 minute');
    expect(formatAge(7 * 60_000, 'en')).toBe('7 minutes');
    expect(formatAge(3 * 3_600_000, 'en')).toBe('3 hours');
    expect(formatAge(7 * 60_000, 'ru')).toMatch(/7 минут/);
  });
});

describe('demo stale mode', () => {
  it('serves a frozen old snapshot with the collector offline', () => {
    const demo = createDemoOffice(NOW, { stale: true });
    const a = demo.tick(NOW);
    const b = demo.tick(NOW + 60_000);
    expect(a).toBe(b);
    expect(a.collectorOnline).toBe(false);
    expect(Date.parse(a.snapshot?.generatedAt ?? '')).toBe(NOW - STALE_DEMO_AGE_MS);
    expect(freshness(a, NOW).kind).toBe('collector_offline');
  });

  it('does not depend on the machine timezone (cron times are UTC)', () => {
    const tick = createDemoOffice(NOW).tick(NOW);
    const hunter = tick.snapshot?.agents.find((a) => a.id === 'opportunity-hunter');
    for (const job of hunter?.cron ?? []) {
      expect(job.nextRunAt?.endsWith('Z')).toBe(true);
      const d = new Date(job.nextRunAt ?? '');
      expect(d.getUTCSeconds()).toBe(0);
    }
  });
});
