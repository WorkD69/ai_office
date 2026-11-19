import type { Agent, AgentStatus, FeedEvent, InboxItem, Snapshot } from './schema.js';

const STATUS_TEXT: Record<AgentStatus, string> = {
  working: 'started working',
  waiting_you: 'is waiting for you',
  waiting_external: 'is waiting on an external service',
  error: 'hit an error',
  idle: 'is idle',
  offline: 'went offline',
};

const STATUS_LEVEL: Record<AgentStatus, FeedEvent['level']> = {
  working: 'info',
  waiting_you: 'warn',
  waiting_external: 'info',
  error: 'error',
  idle: 'info',
  offline: 'warn',
};

/**
 * Turns two consecutive snapshots into human-readable feed events.
 * Pure and deterministic: event ids are derived from inputs, so a replayed
 * snapshot never duplicates feed entries.
 */
export function diffSnapshots(prev: Snapshot | null, next: Snapshot): FeedEvent[] {
  const events: FeedEvent[] = [];
  const before = new Map<string, Agent>((prev?.agents ?? []).map((a) => [a.id, a]));
  const at = next.generatedAt;

  for (const agent of next.agents) {
    const old = before.get(agent.id);
    if (!old) {
      if (prev) {
        events.push(
          ev(`${agent.id}:joined:${at}`, at, agent.id, 'info', `${agent.name} joined the office`),
        );
      }
      continue;
    }
    if (old.status !== agent.status) {
      const suffix = agent.status === 'working' && agent.activity ? `: ${agent.activity}` : '';
      events.push(
        ev(
          `${agent.id}:status:${agent.status}:${at}`,
          at,
          agent.id,
          STATUS_LEVEL[agent.status],
          `${agent.name} ${STATUS_TEXT[agent.status]}${suffix}`,
        ),
      );
    } else if (agent.status === 'working' && agent.activity && agent.activity !== old.activity) {
      events.push(
        ev(`${agent.id}:activity:${at}`, at, agent.id, 'info', `${agent.name}: ${agent.activity}`),
      );
    }

    const oldCron = new Map(old.cron.map((j) => [j.id, j]));
    for (const job of agent.cron) {
      const o = oldCron.get(job.id);
      if (job.lastRunAt && job.lastRunAt !== o?.lastRunAt) {
        const failed = job.lastStatus === 'error';
        const outcome = failed ? 'failed' : job.lastStatus === 'ok' ? 'ok' : 'finished';
        events.push(
          ev(
            `${agent.id}:cron:${job.id}:${job.lastRunAt}`,
            at,
            agent.id,
            failed ? 'error' : 'info',
            `${agent.name} ran scheduled job "${job.name}": ${outcome}`,
          ),
        );
      }
    }
  }

  if (prev) {
    const nowIds = new Set(next.agents.map((a) => a.id));
    for (const old of prev.agents) {
      if (!nowIds.has(old.id)) {
        events.push(ev(`${old.id}:left:${at}`, at, old.id, 'warn', `${old.name} left the office`));
      }
    }
  }
  return events.map(clampText);
}

const INBOX_ORDER: Record<InboxItem['kind'], number> = {
  approval: 0,
  error: 1,
  offline: 2,
  cron_failed: 3,
};

/** Everything that needs the owner's attention, most urgent first. */
export function deriveInbox(snapshot: Snapshot | null): InboxItem[] {
  if (!snapshot) return [];
  const items: InboxItem[] = [];
  for (const a of snapshot.agents) {
    if (a.status === 'waiting_you') {
      items.push({
        id: `${a.id}:approval`,
        agentId: a.id,
        kind: 'approval',
        title: `${a.name} is waiting for your decision${a.activity ? `: ${a.activity}` : ''}`,
        since: a.lastActivityAt,
      });
    }
    if (a.status === 'error') {
      items.push({
        id: `${a.id}:error`,
        agentId: a.id,
        kind: 'error',
        title: `${a.name} is in an error state${a.activity ? `: ${a.activity}` : ''}`,
        since: a.lastActivityAt,
      });
    }
    // A closed laptop is normal for dev agents, so it is not an alert.
    if (a.status === 'offline' && a.kind !== 'dev') {
      items.push({
        id: `${a.id}:offline`,
        agentId: a.id,
        kind: 'offline',
        title: `${a.name} is offline`,
        since: a.lastActivityAt,
      });
    }
    for (const j of a.cron) {
      if (j.enabled && j.lastStatus === 'error') {
        items.push({
          id: `${a.id}:cron:${j.id}`,
          agentId: a.id,
          kind: 'cron_failed',
          title: `${a.name}: scheduled job "${j.name}" failed on its last run`,
          since: j.lastRunAt,
        });
      }
    }
  }
  return items
    .map((i) => ({ ...i, title: i.title.slice(0, 160) }))
    .sort((x, y) => INBOX_ORDER[x.kind] - INBOX_ORDER[y.kind]);
}

function ev(
  id: string,
  at: string,
  agentId: string | null,
  level: FeedEvent['level'],
  text: string,
): FeedEvent {
  return { id: id.slice(0, 80), at, agentId, level, text };
}

function clampText(e: FeedEvent): FeedEvent {
  return e.text.length > 240 ? { ...e, text: `${e.text.slice(0, 239)}…` } : e;
}
