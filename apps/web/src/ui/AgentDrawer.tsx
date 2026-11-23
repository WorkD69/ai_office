import { useEffect, useRef } from 'react';
import type { Agent } from '@ai-office/protocol';
import { roomLabel, useI18n } from '../i18n';
import { agentDetail } from '../lib/messages';
import { formatClock, formatCompact } from '../lib/time';
import { RelativeTime, StatusDot } from './common';

interface Props {
  agent: Agent;
  now: number;
  onClose: () => void;
}

export function AgentDrawer({ agent, now, onClose }: Props) {
  const tr = useI18n();
  const { t, lang } = tr;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent.id, onClose]);

  const usage = agent.usageToday;
  // An offline agent's last activity is stale, but the reason it is offline is worth showing.
  const detail = agent.reason || agent.status !== 'offline' ? agentDetail(tr, agent) : null;
  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-labelledby="drawer-title">
      <div className="drawer__head">
        <StatusDot status={agent.status} />
        <div>
          <h2 id="drawer-title">{agent.name}</h2>
          <p className="drawer__status">{t(`status.${agent.status}`)}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label={t('drawer.close')}
        >
          ×
        </button>
      </div>

      {detail && <p className="drawer__activity">{detail}</p>}

      <dl className="facts">
        <dt>{t('drawer.role')}</dt>
        <dd>{agent.role || t('drawer.none')}</dd>
        <dt>{t('drawer.kind')}</dt>
        <dd>{t(`kind.${agent.kind}`)}</dd>
        <dt>{t('drawer.room')}</dt>
        <dd>{roomLabel(tr, agent.room)}</dd>
        <dt>{t('drawer.model')}</dt>
        <dd>{agent.model ?? t('drawer.none')}</dd>
        <dt>{t('drawer.lastActivity')}</dt>
        <dd>
          <RelativeTime iso={agent.lastActivityAt} now={now} />
          {!agent.lastActivityAt && t('drawer.none')}
        </dd>
      </dl>

      {usage && (
        <>
          <h3>{t('drawer.usage')}</h3>
          <dl className="usage">
            <div>
              <dt>{t('drawer.apiCalls')}</dt>
              <dd>{formatCompact(usage.apiCalls, lang)}</dd>
            </div>
            <div>
              <dt>{t('drawer.tokensIn')}</dt>
              <dd>{formatCompact(usage.inputTokens, lang)}</dd>
            </div>
            <div>
              <dt>{t('drawer.cacheRead')}</dt>
              <dd>{formatCompact(usage.cacheReadTokens, lang)}</dd>
            </div>
            <div>
              <dt>{t('drawer.tokensOut')}</dt>
              <dd>{formatCompact(usage.outputTokens, lang)}</dd>
            </div>
          </dl>
        </>
      )}

      <h3>{t('drawer.cron')}</h3>
      {agent.cron.length === 0 ? (
        <p className="empty">{t('drawer.noCron')}</p>
      ) : (
        <ul className="cron">
          {agent.cron.map((job) => (
            <li key={job.id} className={`cron__job cron__job--${job.lastStatus ?? 'never'}`}>
              <span className="cron__name">{job.name}</span>
              <span className="cron__schedule">{job.schedule}</span>
              <span className="cron__meta">
                {job.enabled
                  ? `${t('drawer.nextRun')} ${formatClock(job.nextRunAt, lang) ?? t('drawer.none')}`
                  : t('drawer.paused')}
              </span>
              <span className={`cron__status cron__status--${job.lastStatus ?? 'never'}`}>
                {job.lastStatus ? t(`cron.${job.lastStatus}`) : t('cron.never')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
