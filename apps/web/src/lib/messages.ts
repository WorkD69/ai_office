import type { FeedEvent, InboxItem, MessageParams } from '@ai-office/protocol';
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
  const hasActivity = item.kind === 'approval' || item.kind === 'error';
  return hasActivity && p.activity !== undefined ? withDetail(tr, text, p.activity) : text;
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
