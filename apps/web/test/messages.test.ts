import { describe, expect, it } from 'vitest';
import {
  AgentStatus,
  FeedCode,
  InboxKind,
  type FeedEvent,
  type InboxItem,
  type MessageParams,
} from '@ai-office/protocol';
import { chooseLang, createTranslator, type Lang } from '../src/i18n';
import { feedText, inboxText } from '../src/lib/messages';

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
