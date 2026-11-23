import { describe, expect, it } from 'vitest';
import {
  deriveInbox,
  diffSnapshots,
  FeedEvent,
  Snapshot,
  type Agent,
  type CronJob,
} from '../src/index.js';

const T0 = '2026-11-19T10:00:00.000Z';
const T1 = '2026-11-19T10:00:10.000Z';

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
    model: 'gpt-6-luna',
    usageToday: null,
    cron: [],
    summary: null,
    chatUrl: null,
    counters: [],
    hasPassport: false,
    project: null,
    ...over,
  };
}

function job(over: Partial<CronJob> = {}): CronJob {
  return {
    id: 'scan-a',
    name: 'scan A',
    schedule: '5 8 * * *',
    enabled: true,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    ...over,
  };
}

function snap(agents: Agent[], at = T0): Snapshot {
  return { v: 2, generatedAt: at, agents, quotas: [], host: null };
}

describe('Snapshot schema', () => {
  it('accepts a valid snapshot', () => {
    expect(Snapshot.safeParse(snap([agent()])).success).toBe(true);
  });

  it('rejects other protocol versions and malformed agent ids', () => {
    expect(Snapshot.safeParse({ ...snap([]), v: 1 }).success).toBe(false);
    expect(Snapshot.safeParse(snap([agent({ id: 'Bad Id!' })])).success).toBe(false);
  });

  it('fills the optional agent fields with empty values when the collector omits them', () => {
    const bare: Record<string, unknown> = { ...agent() };
    for (const key of ['summary', 'chatUrl', 'counters', 'hasPassport', 'project']) {
      delete bare[key];
    }
    const parsed = Snapshot.parse({ ...snap([]), agents: [bare] });
    expect(parsed.agents[0]).toMatchObject({
      summary: null,
      chatUrl: null,
      counters: [],
      hasPassport: false,
      project: null,
    });
  });

  it('accepts chat links only on t.me', () => {
    const ok = (chatUrl: string) => Snapshot.safeParse(snap([agent({ chatUrl })])).success;
    expect(ok('https://t.me/example_office_bot')).toBe(true);
    expect(ok('https://t.me/example_office_bot?start=hello')).toBe(true);
    expect(ok('http://t.me/example_office_bot')).toBe(false);
    expect(ok('https://t.me.evil.example/x_bot')).toBe(false);
    expect(ok('https://evil.example/t.me/x_bot')).toBe(false);
    expect(ok('https://user@t.me/example_office_bot')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
  });

  it('limits summary, project and counters', () => {
    const ok = (over: Partial<Agent>) => Snapshot.safeParse(snap([agent(over)])).success;
    expect(ok({ summary: 'x'.repeat(120), project: 'p'.repeat(48) })).toBe(true);
    expect(ok({ summary: 'x'.repeat(121) })).toBe(false);
    expect(ok({ project: 'p'.repeat(49) })).toBe(false);
    const counter = { label: 'Vacancies found', value: 3, period: 'week' as const };
    expect(ok({ counters: [counter, counter, counter] })).toBe(true);
    expect(ok({ counters: [counter, counter, counter, counter] })).toBe(false);
    expect(ok({ counters: [{ label: 'x'.repeat(41), value: 1 }] })).toBe(false);
  });

  it('carries a list of at most four quotas', () => {
    const quota = { provider: 'codex', windows: [], observedAt: T0 };
    const ok = (n: number) =>
      Snapshot.safeParse({ ...snap([]), quotas: Array(n).fill(quota) }).success;
    expect(ok(4)).toBe(true);
    expect(ok(5)).toBe(false);
  });
});

describe('FeedEvent schema', () => {
  it('accepts coded events and legacy events that only have text', () => {
    const base = { id: 'e1', at: T0, agentId: null, level: 'info' as const };
    const ok = (extra: object) => FeedEvent.safeParse({ ...base, ...extra }).success;
    expect(ok({ code: 'joined', params: { name: 'A' } })).toBe(true);
    expect(ok({ text: 'Old event from v1' })).toBe(true);
    expect(ok({})).toBe(false);
    expect(ok({ code: 'unknown_code', params: {} })).toBe(false);
  });
});

describe('diffSnapshots', () => {
  it('emits nothing for the very first snapshot', () => {
    expect(diffSnapshots(null, snap([agent()]))).toEqual([]);
  });

  it('reports status changes as a code with the name, status and current activity', () => {
    const events = diffSnapshots(
      snap([agent()]),
      snap([agent({ status: 'working', activity: 'searching the web' })], T1),
    );
    expect(events).toEqual([
      {
        id: `coordinator:status:working:${T1}`,
        at: T1,
        agentId: 'coordinator',
        level: 'info',
        code: 'status',
        params: { name: 'Coordinator', status: 'working', activity: 'searching the web' },
      },
    ]);
  });

  it('does not attach an activity to non-working statuses', () => {
    const [event] = diffSnapshots(
      snap([agent()]),
      snap([agent({ status: 'error', activity: 'collector: OSError' })], T1),
    );
    expect(event?.code).toBe('status');
    expect(event?.params).toEqual({ name: 'Coordinator', status: 'error' });
    expect(event?.level).toBe('error');
  });

  it('reports a new activity of a working agent', () => {
    const events = diffSnapshots(
      snap([agent({ status: 'working', activity: 'step one' })]),
      snap([agent({ status: 'working', activity: 'step two' })], T1),
    );
    expect(events.map((e) => [e.code, e.params])).toEqual([
      ['activity', { name: 'Coordinator', activity: 'step two' }],
    ]);
  });

  it('is deterministic: same input gives the same event ids', () => {
    const a = snap([agent()]);
    const b = snap([agent({ status: 'error' })], T1);
    expect(diffSnapshots(a, b)).toEqual(diffSnapshots(a, b));
  });

  it('reports finished cron runs, joins and leaves', () => {
    const prev = snap([agent({ cron: [job()] }), agent({ id: 'old', name: 'Old' })]);
    const next = snap(
      [
        agent({ cron: [job({ lastRunAt: T1, lastStatus: 'ok' })] }),
        agent({ id: 'new', name: 'New' }),
      ],
      T1,
    );
    const coded = diffSnapshots(prev, next).map((e) => [e.code, e.params, e.level]);
    expect(coded).toContainEqual([
      'cron_ran',
      { name: 'Coordinator', job: 'scan A', outcome: 'ok' },
      'info',
    ]);
    expect(coded).toContainEqual(['joined', { name: 'New' }, 'info']);
    expect(coded).toContainEqual(['left', { name: 'Old' }, 'warn']);
  });

  it('produces only schema-valid coded events, never ready-made text', () => {
    const events = diffSnapshots(
      snap([agent({ cron: [job()] })]),
      snap(
        [
          agent({
            status: 'working',
            activity: 'x'.repeat(160),
            cron: [job({ lastRunAt: T1, lastStatus: null })],
          }),
        ],
        T1,
      ),
    );
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(FeedEvent.safeParse(e).success).toBe(true);
      expect(e.code).toBeDefined();
      expect(e.text).toBeUndefined();
    }
  });
});

describe('a failed scheduled job is not a broken agent', () => {
  const failedJob = job({ lastRunAt: T1, lastStatus: 'error' });
  const before = snap([agent({ id: 'hunter', name: 'Hunter', cron: [job()] })]);
  const after = snap([agent({ id: 'hunter', name: 'Hunter', cron: [failedJob] })], T1);

  it('gives a cron_failed item naming the job, and no error item', () => {
    expect(deriveInbox(after)).toEqual([
      {
        id: 'hunter:cron:scan-a',
        agentId: 'hunter',
        kind: 'cron_failed',
        params: { name: 'Hunter', job: 'scan A' },
        since: T1,
      },
    ]);
  });

  it('gives a failed cron_ran event, and no status event', () => {
    const events = diffSnapshots(before, after);
    expect(events.map((e) => [e.code, e.params, e.level])).toEqual([
      ['cron_ran', { name: 'Hunter', job: 'scan A', outcome: 'failed' }, 'error'],
    ]);
  });

  it('leaves the agent status untouched', () => {
    deriveInbox(after);
    diffSnapshots(before, after);
    expect(after.agents[0]?.status).toBe('idle');
  });
});

describe('deriveInbox', () => {
  it('orders approvals first, then errors, offline agents, then failed cron jobs', () => {
    const inbox = deriveInbox(
      snap([
        agent({
          id: 'hunter',
          name: 'Hunter',
          cron: [job({ lastRunAt: T0, lastStatus: 'error' })],
        }),
        agent({ id: 'bot', name: 'Bot', kind: 'worker', status: 'offline' }),
        agent({ id: 'broken', name: 'Broken', status: 'error' }),
        agent({ id: 'boss', name: 'Boss', status: 'waiting_you', activity: 'run shell command' }),
      ]),
    );
    expect(inbox.map((i) => i.kind)).toEqual(['approval', 'error', 'offline', 'cron_failed']);
    expect(inbox[0]?.params).toEqual({ name: 'Boss', activity: 'run shell command' });
    expect(inbox[1]?.params).toEqual({ name: 'Broken' });
    expect(inbox[2]?.params).toEqual({ name: 'Bot' });
  });

  it('ignores disabled jobs and offline dev agents (a closed laptop is normal)', () => {
    const inbox = deriveInbox(
      snap([
        agent({ id: 'cc', kind: 'dev', status: 'offline' }),
        agent({ cron: [job({ enabled: false, lastRunAt: T0, lastStatus: 'error' })] }),
      ]),
    );
    expect(inbox).toEqual([]);
  });
});
