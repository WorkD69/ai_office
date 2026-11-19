import { z } from 'zod';

/** Protocol version. Bump on breaking changes; the worker rejects other versions. */
export const PROTOCOL_VERSION = 1 as const;

/**
 * What a desk occupant is:
 * - `llm`    — an LLM agent (Hermes profile) that spends model quota;
 * - `worker` — a deterministic script / bot (systemd unit), no quota;
 * - `dev`    — a developer-side coding agent (e.g. Claude Code on a laptop).
 */
export const AgentKind = z.enum(['llm', 'worker', 'dev']);
export type AgentKind = z.infer<typeof AgentKind>;

/**
 * Status vocabulary. `waiting_you` is deliberately separate from `waiting_external`:
 * the dashboard's first job is answering "what needs me right now".
 */
export const AgentStatus = z.enum([
  'working',
  'waiting_you',
  'waiting_external',
  'error',
  'idle',
  'offline',
]);
export type AgentStatus = z.infer<typeof AgentStatus>;

const isoDate = z.string().datetime({ offset: true });

export const CronJob = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  schedule: z.string().max(80),
  enabled: z.boolean(),
  nextRunAt: isoDate.nullable(),
  lastRunAt: isoDate.nullable(),
  lastStatus: z.enum(['ok', 'error', 'unknown']).nullable(),
});
export type CronJob = z.infer<typeof CronJob>;

export const Usage = z.object({
  apiCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof Usage>;

export const Agent = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
  name: z.string().min(1).max(40),
  role: z.string().max(80),
  room: z.string().regex(/^[a-z0-9-]{1,32}$/),
  kind: AgentKind,
  status: AgentStatus,
  /** Short human-readable description of the current/last activity. Never raw message text. */
  activity: z.string().max(160).nullable(),
  lastActivityAt: isoDate.nullable(),
  model: z.string().max(60).nullable(),
  /** Usage since local midnight (collector timezone). */
  usageToday: Usage.nullable(),
  cron: z.array(CronJob).max(50),
});
export type Agent = z.infer<typeof Agent>;

export const QuotaWindow = z.object({
  name: z.string().max(20),
  usedPercent: z.number().min(0).max(100),
  resetsAt: isoDate.nullable(),
});
export type QuotaWindow = z.infer<typeof QuotaWindow>;

export const Quota = z.object({
  provider: z.string().max(40),
  windows: z.array(QuotaWindow).max(4),
  observedAt: isoDate,
});
export type Quota = z.infer<typeof Quota>;

export const HostService = z.object({
  name: z.string().max(80),
  active: z.boolean(),
});

export const Host = z.object({
  memUsedMb: z.number().nonnegative(),
  memTotalMb: z.number().positive(),
  diskUsedPercent: z.number().min(0).max(100),
  load1: z.number().nonnegative(),
  services: z.array(HostService).max(40),
});
export type Host = z.infer<typeof Host>;

/** Full state pushed by the collector. Sanitised: no tokens, chat ids or message bodies. */
export const Snapshot = z.object({
  v: z.literal(PROTOCOL_VERSION),
  generatedAt: isoDate,
  agents: z.array(Agent).max(64),
  quota: Quota.nullable(),
  host: Host.nullable(),
});
export type Snapshot = z.infer<typeof Snapshot>;

export const FeedEvent = z.object({
  id: z.string().max(80),
  at: isoDate,
  agentId: z.string().max(48).nullable(),
  level: z.enum(['info', 'warn', 'error']),
  text: z.string().max(240),
});
export type FeedEvent = z.infer<typeof FeedEvent>;

/** "Needs you" item. Derived from a snapshot, so it disappears when the cause is resolved. */
export const InboxItem = z.object({
  id: z.string().max(120),
  agentId: z.string().max(48),
  kind: z.enum(['approval', 'error', 'cron_failed', 'offline']),
  title: z.string().max(160),
  since: isoDate.nullable(),
});
export type InboxItem = z.infer<typeof InboxItem>;

/** Allow-listed control actions (phase 3). Anything not listed here can never be executed. */
export const CommandAction = z.enum([
  'agent.task',
  'agent.stop',
  'approval.respond',
  'cron.pause',
  'cron.resume',
  'cron.run',
]);
export type CommandAction = z.infer<typeof CommandAction>;

export const Command = z.object({
  id: z.string().uuid(),
  action: CommandAction,
  agentId: z.string().max(48),
  args: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean()])),
  issuedAt: isoDate,
  /** Commands expire quickly; the collector rejects stale or replayed ids. */
  expiresAt: isoDate,
});
export type Command = z.infer<typeof Command>;

// ---- wire messages ----

/** collector -> worker */
export const CollectorMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), snapshot: Snapshot }),
  z.object({ type: z.literal('heartbeat'), at: isoDate }),
  z.object({
    type: z.literal('command_result'),
    commandId: z.string().uuid(),
    ok: z.boolean(),
    detail: z.string().max(500),
  }),
]);
export type CollectorMessage = z.infer<typeof CollectorMessage>;

export const OfficeState = z.object({
  snapshot: Snapshot.nullable(),
  feed: z.array(FeedEvent),
  inbox: z.array(InboxItem),
  collectorOnline: z.boolean(),
  collectorLastSeenAt: isoDate.nullable(),
});
export type OfficeState = z.infer<typeof OfficeState>;

/** worker -> browser */
export const ServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: OfficeState }),
  z.object({ type: z.literal('event'), event: FeedEvent }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/**
 * worker -> collector. Only `command` exists, and it is not sent yet (phase 3): the relay must
 * still validate the action against its own allow-list and reject expired or replayed ids.
 */
export const WorkerToCollectorMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command'), command: Command }),
]);
export type WorkerToCollectorMessage = z.infer<typeof WorkerToCollectorMessage>;
