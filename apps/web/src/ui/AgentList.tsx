import { useRef, type KeyboardEvent } from 'react';
import type { Agent } from '@ai-office/protocol';
import { roomLabel, useI18n } from '../i18n';
import { RelativeTime, StatusDot } from './common';

interface Props {
  agents: readonly Agent[];
  selectedId: string | null;
  now: number;
  onSelect: (id: string) => void;
}

const STATUS_ORDER: Record<Agent['status'], number> = {
  waiting_you: 0,
  error: 1,
  working: 2,
  waiting_external: 3,
  idle: 4,
  offline: 5,
};

export function sortAgents(agents: readonly Agent[]): Agent[] {
  return [...agents].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
  );
}

export function AgentList({ agents, selectedId, now, onSelect }: Props) {
  const tr = useI18n();
  const { t } = tr;
  const listRef = useRef<HTMLUListElement>(null);

  // Arrow keys move focus between cards (roving focus without extra state).
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>('button.agent') ?? []),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
    e.preventDefault();
  };

  return (
    <section className="card" aria-labelledby="agents-title">
      <h2 id="agents-title">{t('agents.title')}</h2>
      <ul className="agents" ref={listRef} onKeyDown={onKeyDown}>
        {sortAgents(agents).map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className={`agent agent--${a.status}${a.id === selectedId ? ' agent--selected' : ''}`}
              aria-pressed={a.id === selectedId}
              onClick={() => onSelect(a.id)}
            >
              <StatusDot status={a.status} />
              <span className="agent__main">
                <span className="agent__top">
                  <span className="agent__name">{a.name}</span>
                  <span className="agent__room">{roomLabel(tr, a.room)}</span>
                </span>
                <span className="agent__activity">
                  {a.status === 'offline'
                    ? t('status.offline')
                    : (a.activity ?? t(`status.${a.status}`))}
                </span>
              </span>
              <span className="agent__time">
                <RelativeTime iso={a.lastActivityAt} now={now} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
