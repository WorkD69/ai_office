import { useEffect, useState } from 'react';
import type { AgentStatus } from '@ai-office/protocol';
import { useI18n } from '../i18n';
import { formatRelative } from '../lib/time';

/** Re-renders periodically so relative times stay fresh. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function StatusDot({ status }: { status: AgentStatus }) {
  const { t } = useI18n();
  return <span className={`dot dot--${status}`} title={t(`status.${status}`)} aria-hidden="true" />;
}

export function RelativeTime({ iso, now }: { iso: string | null; now: number }) {
  const { lang, t } = useI18n();
  const label = formatRelative(iso, now, lang, t('time.justNow'));
  if (!label || !iso) return null;
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString(lang)}>
      {label}
    </time>
  );
}

export function Meter({ percent, label }: { percent: number; label: string }) {
  const level = percent < 60 ? 'ok' : percent < 85 ? 'warn' : 'bad';
  return (
    <div
      className={`meter meter--${level}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-label={label}
    >
      <div className="meter__fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}
