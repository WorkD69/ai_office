import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Agent } from '@ai-office/protocol';
import type { DeniedConnection } from './data/live';
import { useOffice } from './data/useOffice';
import { roomLabel, useI18n, type MessageKey } from './i18n';
import { freshness } from './lib/freshness';
import { agentDetail } from './lib/messages';
import { formatAge } from './lib/time';
import { OfficeCanvas } from './office/OfficeCanvas';
import type { SceneLabels } from './office/renderer';
import { getTelegram, haptic } from './telegram';
import { AgentDrawer } from './ui/AgentDrawer';
import { AgentList } from './ui/AgentList';
import { useNow } from './ui/common';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Header } from './ui/Header';
import { Inbox } from './ui/Inbox';
import { Feed, HostCard, QuotaCard } from './ui/Widgets';

type Tab = 'inbox' | 'agents' | 'feed';
const ACTIVE: ReadonlySet<Agent['status']> = new Set([
  'working',
  'waiting_you',
  'waiting_external',
]);

const DENIED_TEXT: Record<DeniedConnection, [MessageKey, MessageKey]> = {
  unauthorized: ['unauthorized.title', 'unauthorized.body'],
  expired: ['expired.title', 'expired.body'],
  not_owner: ['notOwner.title', 'notOwner.body'],
  not_configured: ['notConfigured.title', 'notConfigured.body'],
};

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function App() {
  const tr = useI18n();
  const { t } = tr;
  const { mode, connection, state } = useOffice();
  const narrow = useMediaQuery('(max-width: 899px)');
  const now = useNow();
  const [tab, setTab] = useState<Tab>('inbox');
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('select'),
  );

  const agents = state?.snapshot?.agents ?? [];
  const selected = agents.find((a) => a.id === selectedId) ?? null;

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) haptic();
  }, []);
  const close = useCallback(() => setSelectedId(null), []);

  // Telegram's native Back button closes the agent details.
  useEffect(() => {
    const back = getTelegram()?.BackButton;
    if (!back || !selected) return;
    back.show();
    back.onClick(close);
    return () => {
      back.offClick(close);
      back.hide();
    };
  }, [selected, close]);

  const labels = useMemo<SceneLabels>(
    () => ({
      room: (id) => roomLabel(tr, id),
      status: (s) => tr.t(`status.${s}`),
    }),
    [tr],
  );
  // The office scene shows `activity` as the agent's line: give it the translated status reason.
  const sceneAgents = useMemo(
    () => agents.map((a) => ({ ...a, activity: agentDetail(tr, a) })),
    [agents, tr],
  );

  if (connection in DENIED_TEXT) {
    const [title, body] = DENIED_TEXT[connection as DeniedConnection];
    return (
      <div className="fullscreen-message">
        <div className="card" role="alert">
          <h2>{t(title)}</h2>
          <p>{t(body)}</p>
        </div>
      </div>
    );
  }

  const fresh = freshness(state, now);
  const staleText =
    fresh.kind === 'stale'
      ? t('conn.stale', { age: formatAge(fresh.ageMs, tr.lang) })
      : fresh.kind === 'collector_offline'
        ? fresh.ageMs !== null && fresh.ageMs > 60_000
          ? t('conn.collectorOfflineAge', { age: formatAge(fresh.ageMs, tr.lang) })
          : t('conn.collectorOffline')
        : null;

  const inbox = state?.inbox ?? [];
  const header = (
    <Header
      connection={connection}
      total={agents.length}
      active={agents.filter((a) => ACTIVE.has(a.status)).length}
      needsYou={inbox.length}
    />
  );

  const inboxCard = <Inbox items={inbox} agents={agents} now={now} onSelect={select} />;
  const teamCard = (
    <AgentList agents={agents} selectedId={selectedId} now={now} onSelect={select} />
  );
  const widgets = (
    <div className="widgets">
      <QuotaCard quotas={state?.snapshot?.quotas ?? []} now={now} />
      <HostCard host={state?.snapshot?.host ?? null} />
    </div>
  );
  const feedCard = <Feed events={state?.feed ?? []} now={now} onSelect={select} />;
  const drawer = selected && <AgentDrawer agent={selected} now={now} onClose={close} />;

  return (
    <div className={`app ${narrow ? 'app--narrow' : 'app--wide'}`}>
      {mode === 'demo' && <div className="banner banner--demo">{t('demo.banner')}</div>}
      {staleText && (
        <div className="banner banner--warn" role="alert">
          {staleText}
        </div>
      )}
      {narrow && header}
      <main className="layout">
        <div className={`scene${staleText ? ' scene--stale' : ''}`}>
          {state && !state.snapshot ? (
            <div className="scene__loading" role="status">
              <div>
                <strong>{t('scene.waitingTitle')}</strong>
                {t('scene.waitingBody')}
              </div>
            </div>
          ) : state ? (
            <ErrorBoundary
              fallback={<div className="scene__fallback">{t('scene.unavailable')}</div>}
            >
              <OfficeCanvas
                agents={sceneAgents}
                selectedId={selectedId}
                onSelect={select}
                labels={labels}
                ariaLabel={t('scene.label', { count: agents.length })}
                mode={narrow ? 'scroll' : 'fit'}
                statusLabel={(a) => t(`status.${a.status}`)}
                unavailableText={t('scene.unavailable')}
                loadingText={t('scene.artLoading')}
                artFailedText={t('scene.artFailed')}
                retryText={t('scene.retry')}
              />
            </ErrorBoundary>
          ) : (
            <div className="scene__loading">{t('conn.connecting')}</div>
          )}
        </div>
        <div className="panel">
          {narrow ? (
            <div className="panel__scroll">
              {tab === 'inbox' && (
                <>
                  {inboxCard}
                  {widgets}
                </>
              )}
              {tab === 'agents' && teamCard}
              {tab === 'feed' && feedCard}
            </div>
          ) : (
            <div className="panel__scroll">
              {header}
              {inboxCard}
              {teamCard}
              {widgets}
              {feedCard}
            </div>
          )}
          {drawer}
        </div>
      </main>
      {narrow && (
        <nav className="tabs" aria-label="Sections">
          {(['inbox', 'agents', 'feed'] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={`tabs__btn${tab === id ? ' tabs__btn--active' : ''}`}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => {
                setTab(id);
                setSelectedId(null);
              }}
            >
              {t(`tab.${id}`)}
              {id === 'inbox' && inbox.length > 0 && <span className="badge">{inbox.length}</span>}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
