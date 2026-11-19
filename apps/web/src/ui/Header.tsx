import type { Connection } from '../data/live';
import { useI18n } from '../i18n';

interface Props {
  connection: Connection;
  total: number;
  active: number;
  needsYou: number;
}

export function Header({ connection, total, active, needsYou }: Props) {
  const { t } = useI18n();
  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__logo" aria-hidden="true" />
        <h1>{t('appTitle')}</h1>
        <span className={`pill pill--${connection}`} role="status">
          {t(`conn.${connection}`)}
        </span>
      </div>
      <dl className="counters">
        <div>
          <dt>{t('counter.agents')}</dt>
          <dd>{total}</dd>
        </div>
        <div>
          <dt>{t('counter.active')}</dt>
          <dd className="counters__active">{active}</dd>
        </div>
        <div>
          <dt>{t('counter.needsYou')}</dt>
          <dd className={needsYou > 0 ? 'counters__alert' : undefined}>{needsYou}</dd>
        </div>
      </dl>
    </header>
  );
}
