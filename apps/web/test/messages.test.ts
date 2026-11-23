import { describe, expect, it } from 'vitest';
import {
  AgentStatus,
  FeedCode,
  InboxKind,
  ReasonCode,
  type Agent,
  type AgentReason,
  type FeedEvent,
  type InboxItem,
  type MessageParams,
} from '@ai-office/protocol';
import { chooseLang, createTranslator, type Lang } from '../src/i18n';
import { agentDetail, feedText, inboxText, reasonText } from '../src/lib/messages';

const AT = '2026-11-19T10:00:00.000Z';
const LANGS: Lang[] = ['en', 'ru'];

function event(code: FeedCode, params: MessageParams): FeedEvent {
  return { id: 'e', at: AT, agentId: 'hunter', level: 'info', code, params };
}

function legacyEvent(text: string): FeedEvent {
  return { id: 'e', at: AT, agentId: 'hunter', level: 'info', text };
}

function item(kind: InboxKind, params: MessageParams): InboxItem {
  return { id: 'i', agentId: 'hunter', kind, params, since: null };
}

/** Every shape of params the protocol's derive functions produce, per code. */
const FEED_CASES: Record<FeedCode, MessageParams[]> = {
  joined: [{ name: 'Hunter' }],
  left: [{ name: 'Hunter' }],
  status: [
    ...AgentStatus.options.map((status) => ({ name: 'Hunter', status })),
    { name: 'Hunter', status: 'working', activity: 'reading mail' },
  ],
  activity: [{ name: 'Hunter', activity: 'reading mail' }],
  cron_ran: ['ok', 'failed', 'finished'].map((outcome) => ({
    name: 'Hunter',
    job: 'scan A',
    outcome,
  })),
  command: ['ok', 'failed'].map((outcome) => ({ outcome, detail: 'cron job not found' })),
};

const INBOX_CASES: Record<InboxKind, MessageParams[]> = {
  approval: [{ name: 'Hunter' }, { name: 'Hunter', activity: 'run shell command' }],
  error: [{ name: 'Hunter' }, { name: 'Hunter', activity: 'collector: OSError' }],
  offline: [{ name: 'Hunter' }],
  cron_failed: [{ name: 'Hunter', job: 'scan A' }],
};

function feedCases(): (readonly [FeedCode, MessageParams])[] {
  return FeedCode.options.flatMap((code) => FEED_CASES[code].map((p) => [code, p] as const));
}

describe('feed and inbox texts', () => {
  it('cover every feed code and inbox kind of the protocol', () => {
    expect(Object.keys(FEED_CASES).sort()).toEqual([...FeedCode.options].sort());
    expect(Object.keys(INBOX_CASES).sort()).toEqual([...InboxKind.options].sort());
  });

  it.each(LANGS)('render every feed code in %s with all params filled in', (lang) => {
    const tr = createTranslator(lang);
    for (const [code, params] of feedCases()) {
      const text = feedText(tr, event(code, params));
      expect(text, `${code} ${JSON.stringify(params)}`).not.toMatch(/[{}]/);
      for (const key of ['name', 'job', 'activity', 'detail'] as const) {
        if (params[key] !== undefined) expect(text).toContain(String(params[key]));
      }
    }
  });

  it.each(LANGS)('render every inbox kind in %s with all params filled in', (lang) => {
    const tr = createTranslator(lang);
    for (const kind of InboxKind.options) {
      for (const params of INBOX_CASES[kind]) {
        const text = inboxText(tr, item(kind, params));
        expect(text, kind).not.toMatch(/[{}]/);
        for (const value of Object.values(params)) expect(text).toContain(String(value));
      }
    }
  });

  it('are actually translated: ru differs from en (except the wordless "{name}: {activity}")', () => {
    const en = createTranslator('en');
    const ru = createTranslator('ru');
    for (const [code, params] of feedCases()) {
      if (code === 'activity') continue;
      expect(feedText(ru, event(code, params))).not.toBe(feedText(en, event(code, params)));
    }
    for (const kind of InboxKind.options) {
      const entry = item(kind, INBOX_CASES[kind][0] as MessageParams);
      expect(inboxText(ru, entry)).not.toBe(inboxText(en, entry));
    }
  });

  it('name the failed job in plain Russian', () => {
    const ru = createTranslator('ru');
    expect(inboxText(ru, item('cron_failed', { name: 'Охотник', job: 'скан вакансий' }))).toBe(
      'Охотник: задача «скан вакансий» не сработала в последний раз',
    );
    expect(feedText(ru, event('status', { name: 'Охотник', status: 'waiting_you' }))).toBe(
      'Охотник ждёт тебя',
    );
  });

  it('show legacy feed events stored with ready-made text as is', () => {
    const tr = createTranslator('ru');
    expect(feedText(tr, legacyEvent('Coordinator hit an error'))).toBe('Coordinator hit an error');
  });

  it('do not break on a status this client does not know yet', () => {
    const tr = createTranslator('en');
    const text = feedText(tr, event('status', { name: 'Hunter', status: 'sleeping' }));
    expect(text).toContain('Hunter');
    expect(text).not.toMatch(/[{}]/);
  });
});

/** Params the collector sends for each reason code (see ReasonCode in the protocol schema). */
const REASON_CASES: Record<ReasonCode, AgentReason['params']> = {
  gateway_missing: {},
  gateway_stopped: {},
  gateway_stale: {},
  platform_missing: { platform: 'Telegram' },
  platform_down: { platform: 'Telegram', state: 'retrying' },
  state_db_missing: {},
  no_units: {},
  unit_failed: { unit: 'broker' },
  unit_down: { unit: 'broker', state: 'inactive' },
  collector_error: { error: 'OSError' },
};

function agentWith(over: Partial<Agent>): Agent {
  return {
    id: 'signals',
    name: 'Signals',
    role: '',
    room: 'trading',
    kind: 'worker',
    status: 'error',
    activity: null,
    lastActivityAt: null,
    model: null,
    usageToday: null,
    cron: [],
    summary: null,
    chatUrl: null,
    counters: [],
    hasPassport: false,
    project: null,
    reason: null,
    ...over,
  };
}

describe('status reasons', () => {
  it('cover every reason code of the protocol', () => {
    expect(Object.keys(REASON_CASES).sort()).toEqual([...ReasonCode.options].sort());
  });

  it.each(LANGS)('render every reason code in %s with its params filled in', (lang) => {
    const tr = createTranslator(lang);
    for (const code of ReasonCode.options) {
      const params = REASON_CASES[code];
      const text = reasonText(tr, code, params);
      expect(text, code).not.toMatch(/[{}]/);
      expect(text, code).not.toContain(code);
      for (const value of Object.values(params)) expect(text, code).toContain(value);
    }
  });

  it('are translated into Russian', () => {
    const en = createTranslator('en');
    const ru = createTranslator('ru');
    for (const code of ReasonCode.options) {
      expect(reasonText(ru, code, REASON_CASES[code])).not.toBe(
        reasonText(en, code, REASON_CASES[code]),
      );
    }
    expect(reasonText(ru, 'gateway_stopped', {})).toBe('шлюз Hermes не запущен');
  });

  it.each(LANGS)(
    'fall back to a generic phrase in %s for unknown codes or missing params',
    (lang) => {
      const tr = createTranslator(lang);
      const unknown = reasonText(tr, 'some_future_reason', { unit: 'broker' });
      expect(unknown).not.toMatch(/[{}]/);
      expect(unknown).not.toContain('some_future_reason');
      expect(unknown).toBe(tr.t('reason.unknown'));
      expect(reasonText(tr, 'unit_down', {})).not.toMatch(/[{}]/);
    },
  );

  it('are added to status events and inbox items that carry a reason code', () => {
    const ru = createTranslator('ru');
    const params = { name: 'Сигналы', reason: 'unit_failed', unit: 'broker' };
    expect(feedText(ru, event('status', { ...params, status: 'error' }))).toBe(
      'Сигналы — ошибка: служба broker упала',
    );
    expect(inboxText(ru, item('error', params))).toBe(
      'Сигналы — ошибка, нужна помощь: служба broker упала',
    );
    const offline = { name: 'Охотник', reason: 'gateway_stopped' };
    expect(inboxText(ru, item('offline', offline))).toBe(
      'Охотник не на связи: шлюз Hermes не запущен',
    );
    expect(inboxText(ru, item('offline', { name: 'Охотник', reason: 'brand_new' }))).not.toMatch(
      /[{}]|brand_new/,
    );
  });

  it("show Hermes' own activity as is and nothing when there is neither", () => {
    const tr = createTranslator('ru');
    expect(agentDetail(tr, agentWith({ status: 'working', activity: 'calling web_search' }))).toBe(
      'calling web_search',
    );
    expect(agentDetail(tr, agentWith({ status: 'working' }))).toBeNull();
    const failed = agentWith({ reason: { code: 'unit_failed', params: { unit: 'broker' } } });
    expect(agentDetail(tr, failed)).toBe('служба broker упала');
    // An older v2 collector without reasons: its English text in activity is shown as is.
    expect(agentDetail(tr, agentWith({ activity: 'broker failed' }))).toBe('broker failed');
    expect(feedText(tr, event('status', { name: 'Охотник', status: 'working' }))).toBe(
      'Охотник — в работе',
    );
  });
});

describe('chooseLang', () => {
  it('speaks Russian to the owner (live) and English in the public demo', () => {
    expect(chooseLang(null, 'live')).toBe('ru');
    expect(chooseLang(null, 'demo')).toBe('en');
  });

  it('lets ?lang= override the default', () => {
    expect(chooseLang('en', 'live')).toBe('en');
    expect(chooseLang('ru', 'demo')).toBe('ru');
  });
});
