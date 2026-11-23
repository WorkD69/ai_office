import type { Agent, InboxItem } from '@ai-office/protocol';
import { useI18n } from '../i18n';
import { inboxText } from '../lib/messages';
import { RelativeTime } from './common';

interface Props {
  items: readonly InboxItem[];
  agents: readonly Agent[];
  now: number;
  onSelect: (agentId: string) => void;
}

const ICON: Record<InboxItem['kind'], string> = {
  approval: '!',
  error: '×',
  offline: '◌',
  cron_failed: '⏱',
};

export function Inbox({ items, agents, now, onSelect }: Props) {
  const tr = useI18n();
  const { t } = tr;
  const names = new Map(agents.map((a) => [a.id, a.name]));
  return (
    <section className="card card--inbox" aria-labelledby="inbox-title">
      <h2 id="inbox-title">
        {t('inbox.title')}
        {items.length > 0 && <span className="badge">{items.length}</span>}
      </h2>
      {items.length === 0 ? (
        <p className="empty">✓ {t('inbox.empty')}</p>
      ) : (
        <ul className="inbox">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`inbox__item inbox__item--${item.kind}`}
                onClick={() => onSelect(item.agentId)}
              >
                <span className="inbox__icon" aria-hidden="true">
                  {ICON[item.kind]}
                </span>
                <span className="inbox__body">
                  <span className="inbox__title">{inboxText(tr, item)}</span>
                  <span className="inbox__meta">
                    {names.get(item.agentId) ?? item.agentId}
                    {item.since && ' · '}
                    <RelativeTime iso={item.since} now={now} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
