import type { FeedEvent, Host, Quota } from '@ai-office/protocol';
import { useI18n } from '../i18n';
import { sortFeed } from '../lib/feed';
import { feedText } from '../lib/messages';
import { formatRelative } from '../lib/time';
import { Meter, RelativeTime } from './common';

export function QuotaCard({ quotas, now }: { quotas: readonly Quota[]; now: number }) {
  const { t } = useI18n();
  return (
    <section className="card card--compact" aria-labelledby="quota-title">
      <h2 id="quota-title">{t('quota.title')}</h2>
      {quotas.length === 0 ? (
        <p className="empty">{t('quota.none')}</p>
      ) : (
        // Providers may repeat (the schema allows it), so the index keeps keys unique.
        quotas.map((q, i) => <QuotaBlock key={`${i}:${q.provider}`} quota={q} now={now} />)
      )}
    </section>
  );
}

function QuotaBlock({ quota, now }: { quota: Quota; now: number }) {
  const { t, lang } = useI18n();
  return (
    <div className="quota">
      <p className="card__hint quota__provider">{quota.provider}</p>
      {quota.windows.length === 0 ? (
        <p className="empty">{t('quota.none')}</p>
      ) : (
        <ul className="bars">
          {quota.windows.map((w) => (
            <li key={w.name}>
              <div className="bars__row">
                <span>{w.name}</span>
                <strong>{Math.round(w.usedPercent)}%</strong>
              </div>
              <Meter percent={w.usedPercent} label={`${t('quota.title')} ${w.name}`} />
              {w.resetsAt && (
                <span className="bars__hint">
                  {t('quota.resets', {
                    time: formatRelative(w.resetsAt, now, lang, t('time.justNow')) ?? '',
                  })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="bars__hint quota__updated">
        {t('quota.updated', {
          time: formatRelative(quota.observedAt, now, lang, t('time.justNow')) ?? '',
        })}
      </p>
    </div>
  );
}

export function HostCard({ host }: { host: Host | null }) {
  const { t } = useI18n();
  if (!host) return null;
  const ramPct = (host.memUsedMb / host.memTotalMb) * 100;
  const down = host.services.filter((s) => !s.active);
  return (
    <section className="card card--compact" aria-labelledby="host-title">
      <h2 id="host-title">{t('host.title')}</h2>
      <ul className="bars">
        <li>
          <div className="bars__row">
            <span>{t('host.ram')}</span>
            <strong>
              {Math.round(host.memUsedMb)} / {Math.round(host.memTotalMb)} MB
            </strong>
          </div>
          <Meter percent={ramPct} label={t('host.ram')} />
        </li>
        <li>
          <div className="bars__row">
            <span>{t('host.disk')}</span>
            <strong>{Math.round(host.diskUsedPercent)}%</strong>
          </div>
          <Meter percent={host.diskUsedPercent} label={t('host.disk')} />
        </li>
      </ul>
      <div className="host__foot">
        <span>
          {t('host.load')} <strong>{host.load1.toFixed(2)}</strong>
        </span>
        <span className={down.length ? 'host__bad' : 'host__ok'}>
          {t('host.services')}{' '}
          <strong>
            {host.services.length - down.length}/{host.services.length}
          </strong>
        </span>
      </div>
      {down.length > 0 && (
        <ul className="services">
          {down.map((s) => (
            <li key={s.name}>✕ {s.name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Feed({
  events,
  now,
  onSelect,
}: {
  events: readonly FeedEvent[];
  now: number;
  onSelect: (id: string) => void;
}) {
  const tr = useI18n();
  const { t } = tr;
  const sorted = sortFeed(events);
  return (
    <section className="card" aria-labelledby="feed-title">
      <h2 id="feed-title">{t('feed.title')}</h2>
      {sorted.length === 0 ? (
        <p className="empty">{t('feed.empty')}</p>
      ) : (
        <ol className="feed">
          {sorted.map((e) => (
            <li key={e.id} className={`feed__item feed__item--${e.level}`}>
              {e.agentId ? (
                <button
                  type="button"
                  className="feed__text"
                  onClick={() => onSelect(e.agentId as string)}
                >
                  {feedText(tr, e)}
                </button>
              ) : (
                <span className="feed__text">{feedText(tr, e)}</span>
              )}
              <span className="feed__time">
                <RelativeTime iso={e.at} now={now} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
