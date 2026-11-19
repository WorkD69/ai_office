import { describe, expect, it } from 'vitest';
import { deriveInbox, diffSnapshots, Snapshot, type Agent, type CronJob } from '../src/index.js';

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
  return { v: 1, generatedAt: at, agents, quota: null, host: null };
}

describe('Snapshot schema', () => {
  it('accepts a valid snapshot', () => {
    expect(Snapshot.safeParse(snap([agent()])).success).toBe(true);
  });

  it('rejects unknown protocol versions and malformed agent ids', () => {
    expect(Snapshot.safeParse({ ...snap([]), v: 2 }).success).toBe(false);
    expect(Snapshot.safeParse(snap([agent({ id: 'Bad Id!' })])).success).toBe(false);
  });
});

describe('diffSnapshots', () => {
  it('emits nothing for the very first snapshot', () => {
    expect(diffSnapshots(null, snap([agent()]))).toEqual([]);
  });

  it('reports status changes together with the current activity', () => {
    const events = diffSnapshots(
      snap([agent()]),
      snap([agent({ status: 'working', activity: 'searching the web' })], T1),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.text).toBe('Coordinator started working: searching the web');
    expect(events[0]?.level).toBe('info');
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
        agent({ cron: [job({ lastRunAt: T1, lastStatus: 'error' })] }),
        agent({ id: 'new', name: 'New' }),
      ],
      T1,
    );
    const texts = diffSnapshots(prev, next).map((e) => e.text);
    expect(texts).toContain('Coordinator ran scheduled job "scan A": failed');
    expect(texts).toContain('New joined the office');
    expect(texts).toContain('Old left the office');
  });
});

describe('deriveInbox', () => {
  it('orders approvals first, then offline agents, then failed cron jobs', () => {
    const inbox = deriveInbox(
      snap([
        agent({
          id: 'hunter',
          name: 'Hunter',
          cron: [job({ lastRunAt: T0, lastStatus: 'error' })],
        }),
        agent({ id: 'bot', name: 'Bot', kind: 'worker', status: 'offline' }),
        agent({ id: 'boss', name: 'Boss', status: 'waiting_you', activity: 'run shell command' }),
      ]),
    );
    expect(inbox.map((i) => i.kind)).toEqual(['approval', 'offline', 'cron_failed']);
    expect(inbox[0]?.title).toContain('run shell command');
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
