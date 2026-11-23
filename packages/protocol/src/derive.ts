import type {
  Agent,
  AgentStatus,
  FeedCode,
  FeedEvent,
  InboxItem,
  MessageParams,
  Snapshot,
} from './schema.js';

const STATUS_LEVEL: Record<AgentStatus, FeedEvent['level']> = {
  working: 'info',
  waiting_you: 'warn',
  waiting_external: 'info',
  error: 'error',
  idle: 'info',
  offline: 'warn',
};

/**
 * Turns two consecutive snapshots into feed events (a code plus parameters; the web app
 * renders the text). Pure and deterministic: event ids are derived from inputs, so a replayed
 * snapshot never duplicates feed entries.
 *
 * A failed scheduled job yields a `cron_ran` event with `outcome: 'failed'` and nothing else:
 * the agent's status is the collector's verdict about the agent, not about one of its jobs.
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
          ev(`${agent.id}:joined:${at}`, at, agent.id, 'info', 'joined', { name: agent.name }),
        );
      }
      continue;
    }
    if (old.status !== agent.status) {
      const params: MessageParams = {
        ...reasonParams(agent),
        name: agent.name,
        status: agent.status,
      };
      if (agent.status === 'working' && agent.activity) params.activity = agent.activity;
      events.push(
        ev(
          `${agent.id}:status:${agent.status}:${at}`,
          at,
          agent.id,
          STATUS_LEVEL[agent.status],
          'status',
          params,
        ),
      );
    } else if (agent.status === 'working' && agent.activity && agent.activity !== old.activity) {
      events.push(
        ev(`${agent.id}:activity:${at}`, at, agent.id, 'info', 'activity', {
          name: agent.name,
          activity: agent.activity,
        }),
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
            'cron_ran',
            { name: agent.name, job: job.name, outcome },
          ),
        );
      }
    }
  }

  if (prev) {
    const nowIds = new Set(next.agents.map((a) => a.id));
    for (const old of prev.agents) {
      if (!nowIds.has(old.id)) {
        events.push(ev(`${old.id}:left:${at}`, at, old.id, 'warn', 'left', { name: old.name }));
      }
    }
  }
  return events;
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
    const reason = reasonParams(a);
    const withActivity: MessageParams = a.reason
      ? { ...reason, name: a.name }
      : a.activity
        ? { name: a.name, activity: a.activity }
        : { name: a.name };
    if (a.status === 'waiting_you') {
      items.push({
        id: `${a.id}:approval`,
        agentId: a.id,
        kind: 'approval',
        params: withActivity,
        since: a.lastActivityAt,
      });
    }
    if (a.status === 'error') {
      items.push({
        id: `${a.id}:error`,
        agentId: a.id,
        kind: 'error',
        params: withActivity,
        since: a.lastActivityAt,
      });
    }
    // A closed laptop is normal for dev agents, so it is not an alert.
    if (a.status === 'offline' && a.kind !== 'dev') {
      items.push({
        id: `${a.id}:offline`,
        agentId: a.id,
        kind: 'offline',
        params: { ...reason, name: a.name },
        since: a.lastActivityAt,
      });
    }
    for (const j of a.cron) {
      if (j.enabled && j.lastStatus === 'error') {
        items.push({
          id: `${a.id}:cron:${j.id}`,
          agentId: a.id,
          kind: 'cron_failed',
          params: { name: a.name, job: j.name },
          since: j.lastRunAt,
        });
      }
    }
  }
  return items.sort((x, y) => INBOX_ORDER[x.kind] - INBOX_ORDER[y.kind]);
}

/**
 * The agent's reason flattened into message params: `reason` (the code) plus its params. The
 * caller spreads it first, so its own keys (`name`, `status`) always win over a reason param.
 */
function reasonParams(agent: Agent): MessageParams {
  if (!agent.reason) return {};
  return { ...agent.reason.params, reason: agent.reason.code };
}

function ev(
  id: string,
  at: string,
  agentId: string | null,
  level: FeedEvent['level'],
  code: FeedCode,
  params: MessageParams,
): FeedEvent {
  return { id: id.slice(0, 80), at, agentId, level, code, params };
}
