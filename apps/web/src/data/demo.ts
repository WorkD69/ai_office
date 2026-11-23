/**
 * "Alive" demo data for the public demo (no real names, ids or secrets).
 * It goes through the same protocol helpers as the real worker (diffSnapshots / deriveInbox),
 * so the demo exercises the production code paths.
 *
 * Deterministic: the output depends only on (seed, startMs, the tick timestamps). The wall clock
 * is used by the caller just to pick `startMs`; cron times are UTC, so the timezone of the
 * machine does not matter.
 */
import {
  deriveInbox,
  diffSnapshots,
  FEED_LIMIT,
  PROTOCOL_VERSION,
  type Agent,
  type AgentKind,
  type AgentStatus,
  type CronJob,
  type FeedEvent,
  type Host,
  type OfficeState,
  type Quota,
  type Snapshot,
} from '@ai-office/protocol';

export const DEMO_TICK_MS = 3_000;
const WARMUP_TICKS = 40;
/** Warm-up history is spread over ~30 minutes so the feed shows realistic times. */
const WARMUP_STEP_MS = 45_000;

interface CronSpec {
  id: string;
  name: string;
  times: Array<[number, number]>;
  lastStatus: CronJob['lastStatus'];
  enabled?: boolean;
}

interface AgentSpec {
  id: string;
  name: string;
  role: string;
  room: string;
  kind: AgentKind;
  model: string | null;
  work: string[];
  waitingYou?: string[];
  external?: string[];
  /** Probability per tick of being picked for a state change. */
  activity: number;
  alwaysOffline?: boolean;
  cron?: CronSpec[];
}

const ROSTER: AgentSpec[] = [
  {
    id: 'coordinator',
    name: 'Coordinator',
    role: 'Main assistant: routes tasks, answers in Telegram',
    room: 'hq',
    kind: 'llm',
    model: 'gpt-6-luna',
    activity: 0.55,
    work: [
      'Searching the web for release notes',
      'Summarising a 40-page PDF',
      'Drafting a reply to the owner',
      'Checking calendar for conflicts',
      'Reading a GitHub issue thread',
    ],
    waitingYou: [
      'Approve: run a Python snippet in the sandbox',
      'Approve: save a new skill "weekly-review"',
    ],
  },
  {
    id: 'opportunity-hunter',
    name: 'Opportunity Hunter',
    role: 'Scholarships, internships and contests with verified deadlines',
    room: 'opportunities',
    kind: 'llm',
    model: 'gpt-6-luna',
    activity: 0.35,
    work: [
      'Scanning sources, batch A',
      'Verifying deadline quotes against the source',
      'Deduplicating 12 new listings',
      'Writing the evening digest',
    ],
    external: ['Waiting for a slow university website'],
    cron: [
      {
        id: 'scan-a',
        name: 'scan A',
        times: [
          [8, 5],
          [14, 5],
          [20, 5],
        ],
        lastStatus: 'ok',
      },
      {
        id: 'scan-b',
        name: 'scan B',
        times: [
          [8, 20],
          [14, 20],
          [20, 20],
        ],
        lastStatus: 'error',
      },
      { id: 'digest', name: 'daily digest', times: [[22, 0]], lastStatus: 'ok' },
    ],
  },
  {
    id: 'crypto-analyst',
    name: 'Crypto Analyst',
    role: 'Turns analysts’ posts into tracked entry zones',
    room: 'trading',
    kind: 'llm',
    model: 'gpt-6-luna',
    activity: 0.4,
    work: [
      'Parsing a new post from analyst #2',
      'Reading levels from a chart image',
      'Checking price against entry zones',
      'Updating zone status: BTC 2 of 3 hit',
    ],
    external: ['Waiting on exchange API rate limit'],
  },
  {
    id: 'community-bot',
    name: 'Community Bot',
    role: 'Game community: nicknames and forum tags',
    room: 'community',
    kind: 'worker',
    model: null,
    activity: 0.3,
    work: ['Handled a /nick command', 'Synced forum tags', 'Welcomed a new member'],
  },
  {
    id: 'news-worker',
    name: 'News Worker',
    role: 'Collects game news from public channels',
    room: 'community',
    kind: 'worker',
    model: null,
    activity: 0.25,
    work: ['Fetching channel updates', 'Posting a news card'],
    external: ['Waiting on Telegram API flood limit'],
  },
  {
    id: 'watchdog',
    name: 'Watchdog',
    role: 'Server health: disk, RAM, services. No LLM unless something breaks',
    room: 'server',
    kind: 'worker',
    model: null,
    activity: 0.3,
    work: [
      'Disk 73% · RAM ok · all services up',
      'Checked container restarts: none',
      'Rotated logs',
    ],
  },
  {
    id: 'archivist',
    name: 'Archivist',
    role: 'Daily log of who did what (one model call per day)',
    room: 'server',
    kind: 'worker',
    model: null,
    activity: 0.15,
    work: ['Collecting today’s events', 'Writing the daily log'],
  },
  {
    id: 'claude-code-1',
    name: 'Claude Code #1',
    role: 'Coding agent on the laptop',
    room: 'dev',
    kind: 'dev',
    model: 'claude',
    activity: 0.4,
    work: [
      'Running the test suite',
      'Refactoring the collector',
      'Reviewing a pull request',
      'Fixing a flaky test',
    ],
    waitingYou: ['Approve: git push to a feature branch'],
  },
  {
    id: 'claude-code-2',
    name: 'Claude Code #2',
    role: 'Second coding session (laptop closed)',
    room: 'dev',
    kind: 'dev',
    model: 'claude',
    activity: 0,
    alwaysOffline: true,
    work: [],
  },
];

interface Runtime {
  status: AgentStatus;
  activity: string | null;
  since: number;
  ticks: number;
  usage: { apiCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

/** Small, fast, seedable PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();

function occurrence(now: number, times: Array<[number, number]>, direction: 1 | -1): number {
  const candidates: number[] = [];
  for (const dayOffset of [-1, 0, 1]) {
    for (const [h, m] of times) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + dayOffset);
      d.setUTCHours(h, m, 0, 0);
      candidates.push(d.getTime());
    }
  }
  const filtered = candidates.filter((c) => (direction === 1 ? c > now : c <= now));
  return direction === 1 ? Math.min(...filtered) : Math.max(...filtered);
}

export interface DemoOffice {
  tick(now: number): OfficeState;
}

/** Showcase start: one agent per status, used for screenshots (?demo&showcase). */
const SHOWCASE: Readonly<Record<string, AgentStatus>> = {
  coordinator: 'waiting_you',
  'crypto-analyst': 'error',
  'news-worker': 'waiting_external',
  archivist: 'idle',
  'opportunity-hunter': 'working',
  'community-bot': 'working',
  watchdog: 'working',
  'claude-code-1': 'working',
};

export interface DemoOptions {
  seed?: number;
  /** Start with one agent per status on screen (for screenshots: `?demo&showcase`). */
  showcase?: boolean;
  /** Simulate a dead collector: frozen, old snapshot and `collectorOnline=false` (`?demo&stale`). */
  stale?: boolean;
}

/** Age of the frozen snapshot in stale mode. */
export const STALE_DEMO_AGE_MS = 7 * 60_000;

export function createDemoOffice(
  startMs: number,
  { seed = 7, showcase = false, stale = false }: DemoOptions = {},
): DemoOffice {
  const rand = mulberry32(seed);
  const pickOne = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;

  const runtime = new Map<string, Runtime>(
    ROSTER.map((spec) => [
      spec.id,
      {
        status: spec.alwaysOffline ? 'offline' : 'idle',
        activity: spec.work[0] ?? null,
        since: startMs - 3_600_000,
        ticks: 0,
        usage: { apiCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      },
    ]),
  );
  let quota5h = 23;
  let quotaWeek = 41;
  let quota5hReset = startMs + 3 * 3_600_000;
  let prev: Snapshot | null = null;
  let feed: FeedEvent[] = [];

  function advance(now: number): void {
    for (const spec of ROSTER) {
      const rt = runtime.get(spec.id) as Runtime;
      rt.ticks++;
      if (spec.alwaysOffline) continue;
      const stuck = (rt.status === 'waiting_you' && rt.ticks < 7) || (showcase && rt.ticks < 2);
      const failing = rt.status === 'error' && rt.ticks < 5;
      if (stuck || failing || rand() > spec.activity) {
        if (rt.status === 'working') addUsage(spec, rt);
        continue;
      }
      const roll = rand();
      let next: AgentStatus;
      if (rt.status === 'working') {
        if (spec.waitingYou && roll < 0.12) next = 'waiting_you';
        else if (spec.external && roll < 0.22) next = 'waiting_external';
        else if (spec.id === 'crypto-analyst' && roll < 0.27) next = 'error';
        else if (roll < 0.6) next = 'working';
        else next = 'idle';
      } else {
        next = roll < 0.75 ? 'working' : 'idle';
      }
      const activity =
        next === 'waiting_you'
          ? pickOne(spec.waitingYou ?? spec.work)
          : next === 'waiting_external'
            ? pickOne(spec.external ?? spec.work)
            : next === 'error'
              ? 'Exchange API returned 502 three times in a row'
              : next === 'working'
                ? pickOne(spec.work)
                : rt.activity;
      if (next !== rt.status || activity !== rt.activity) {
        rt.status = next;
        rt.activity = activity;
        rt.since = now;
        rt.ticks = 0;
      }
      if (rt.status === 'working') addUsage(spec, rt);
    }

    const busyLlm = ROSTER.filter(
      (s) => s.kind === 'llm' && runtime.get(s.id)?.status === 'working',
    ).length;
    quota5h = Math.min(99, quota5h + busyLlm * 0.35);
    quotaWeek = Math.min(99, quotaWeek + busyLlm * 0.02);
    if (now >= quota5hReset) {
      quota5h = 4;
      quota5hReset = now + 5 * 3_600_000;
    }
  }

  function addUsage(spec: AgentSpec, rt: Runtime): void {
    if (spec.kind !== 'llm') return;
    const calls = 1 + Math.floor(rand() * 3);
    rt.usage.apiCalls += calls;
    rt.usage.inputTokens += calls * (14_000 + Math.floor(rand() * 4_000));
    rt.usage.cacheReadTokens += calls * (12_500 + Math.floor(rand() * 2_000));
    rt.usage.outputTokens += calls * (250 + Math.floor(rand() * 700));
  }

  function snapshot(now: number): Snapshot {
    const agents: Agent[] = ROSTER.map((spec) => {
      const rt = runtime.get(spec.id) as Runtime;
      return {
        id: spec.id,
        name: spec.name,
        role: spec.role,
        room: spec.room,
        kind: spec.kind,
        status: rt.status,
        activity: rt.status === 'offline' ? null : rt.activity,
        lastActivityAt: iso(rt.since),
        model: spec.model,
        usageToday: spec.kind === 'llm' ? { ...rt.usage } : null,
        cron: (spec.cron ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          schedule: c.times
            .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
            .join(', '),
          enabled: c.enabled ?? true,
          nextRunAt: iso(occurrence(now, c.times, 1)),
          lastRunAt: iso(occurrence(now, c.times, -1)),
          lastStatus: c.lastStatus,
        })),
        // Card fields (description, chat link, own numbers) are filled in with the v2 card.
        summary: null,
        chatUrl: null,
        counters: [],
        hasPassport: false,
        project: null,
        // Demo lines are free text in English, like Hermes' own activity descriptions.
        reason: null,
      };
    });
    const quota: Quota = {
      provider: 'openai-codex',
      observedAt: iso(now),
      windows: [
        { name: '5h', usedPercent: Math.round(quota5h * 10) / 10, resetsAt: iso(quota5hReset) },
        {
          name: 'week',
          usedPercent: Math.round(quotaWeek * 10) / 10,
          resetsAt: iso(startMs + 4 * 86_400_000),
        },
      ],
    };
    const wobble = Math.sin(now / 20_000);
    const host: Host = {
      memUsedMb: Math.round(1060 + wobble * 25 + rand() * 10),
      memTotalMb: 1967,
      diskUsedPercent: 73,
      load1: Math.round((0.08 + Math.abs(wobble) * 0.3) * 100) / 100,
      services: [
        { name: 'hermes-gateway', active: true },
        { name: 'signals-worker', active: true },
        { name: 'signals-broker', active: true },
        { name: 'community-bot', active: true },
        { name: 'news-worker', active: true },
        { name: 'fail2ban', active: true },
      ],
    };
    return { v: PROTOCOL_VERSION, generatedAt: iso(now), agents, quotas: [quota], host };
  }

  function step(now: number): OfficeState {
    advance(now);
    const next = snapshot(now);
    feed = [...diffSnapshots(prev, next).reverse(), ...feed].slice(0, FEED_LIMIT);
    prev = next;
    return {
      snapshot: next,
      feed,
      inbox: deriveInbox(next),
      collectorOnline: true,
      collectorLastSeenAt: iso(now),
    };
  }

  // Warm up so the feed is not empty on first paint. In stale mode history ends early.
  const historyEnd = stale ? startMs - STALE_DEMO_AGE_MS : startMs;
  for (let i = WARMUP_TICKS; i > 0; i--) step(historyEnd - i * WARMUP_STEP_MS);

  if (showcase) {
    for (const spec of ROSTER) {
      const status = SHOWCASE[spec.id];
      const rt = runtime.get(spec.id) as Runtime;
      if (!status) continue;
      rt.status = status;
      rt.ticks = 0;
      rt.since = startMs - DEMO_TICK_MS;
      rt.activity =
        status === 'waiting_you'
          ? (spec.waitingYou?.[0] ?? null)
          : status === 'waiting_external'
            ? (spec.external?.[0] ?? null)
            : status === 'error'
              ? 'Exchange API returned 502 three times in a row'
              : (spec.work[1] ?? spec.work[0] ?? null);
    }
  }

  if (stale) {
    const frozen = step(historyEnd);
    const offline: OfficeState = { ...frozen, collectorOnline: false };
    return { tick: () => offline };
  }

  return { tick: step };
}
