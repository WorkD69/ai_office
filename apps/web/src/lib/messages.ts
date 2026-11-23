import type { Agent, FeedEvent, InboxItem, MessageParams } from '@ai-office/protocol';
import { isMessageKey, type MessageKey, type Translator } from '../i18n';

/**
 * Protocol v2 sends feed events and "needs you" items as a code plus parameters; this module
 * turns them into text in the viewer's language. Unknown values (a newer worker than this
 * client) fall back to a generic line instead of throwing or showing raw `{placeholders}`.
 */

/** Text of a feed event. Events stored by protocol v1 have no code and keep their own text. */
export function feedText(tr: Translator, event: FeedEvent): string {
  const p = event.params ?? {};
  switch (event.code) {
    case undefined:
      return event.text ?? tr.t('event.unknown');
    case 'joined':
    case 'left':
      return tr.t(`event.${event.code}`, { name: str(p.name) });
    case 'status': {
      const text = tr.t(known(`event.status.${str(p.status)}`, 'event.status.other'), {
        name: str(p.name),
      });
      if (p.reason !== undefined) return withDetail(tr, text, reasonText(tr, str(p.reason), p));
      return p.activity === undefined ? text : withDetail(tr, text, p.activity);
    }
    case 'activity':
      return tr.t('event.activity', { name: str(p.name), activity: str(p.activity) });
    case 'cron_ran':
      return tr.t(known(`event.cron.${str(p.outcome)}`, 'event.cron.finished'), {
        name: str(p.name),
        job: str(p.job),
      });
    case 'command':
      return tr.t(p.outcome === 'ok' ? 'event.command.ok' : 'event.command.failed', {
        detail: str(p.detail),
      });
  }
  return tr.t('event.unknown');
}

/** Text of a "needs you" item. */
export function inboxText(tr: Translator, item: InboxItem): string {
  const p: MessageParams = item.params;
  const vars = { name: str(p.name), job: str(p.job) };
  const text = tr.t(`inbox.${item.kind}`, vars);
  if (p.reason !== undefined && item.kind !== 'cron_failed') {
    return withDetail(tr, text, reasonText(tr, str(p.reason), p));
  }
  const hasActivity = item.kind === 'approval' || item.kind === 'error';
  return hasActivity && p.activity !== undefined ? withDetail(tr, text, p.activity) : text;
}

/** Every param a reason text may use; a missing one shows as "?" rather than `{unit}`. */
const REASON_VARS = ['platform', 'state', 'unit', 'error'] as const;

/** Reason codes whose `state` param is a known word (PlatformState / UnitState) to translate. */
const STATE_FAMILY: Readonly<Record<string, 'platform' | 'unit'>> = {
  platform_down: 'platform',
  unit_down: 'unit',
};

/**
 * Text of the collector's status reason (`Agent.reason`, or `reason` plus params in a feed event
 * or inbox item). A code this client does not know gives a generic phrase.
 */
export function reasonText(
  tr: Translator,
  code: string,
  params: Readonly<Record<string, string | number | undefined>>,
): string {
  const key = `reason.${code}`;
  if (!isMessageKey(key)) return tr.t('reason.unknown');
  const vars: Record<string, string> = {};
  for (const name of REASON_VARS) vars[name] = params[name] === undefined ? '?' : str(params[name]);
  const family = STATE_FAMILY[code];
  if (family) {
    // Never the raw word: a state this client does not know reads as "unknown state".
    vars.state = tr.t(known(`state.${family}.${str(params.state)}`, `state.${family}.unknown`));
  }
  return tr.t(key, vars);
}

/**
 * The detail line under an agent's status: the collector's reason in the viewer's language, else
 * Hermes' own activity description as is (not translated), else nothing.
 */
export function agentDetail(tr: Translator, agent: Agent): string | null {
  if (agent.reason) return reasonText(tr, agent.reason.code, agent.reason.params);
  return agent.activity;
}

function withDetail(tr: Translator, text: string, detail: string | number): string {
  return tr.t('message.withDetail', { text, detail: String(detail) });
}

function known(key: string, fallback: MessageKey): MessageKey {
  return isMessageKey(key) ? key : fallback;
}

function str(value: string | number | undefined): string {
  return value === undefined ? '' : String(value);
}
