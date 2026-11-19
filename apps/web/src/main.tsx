import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createTranslator, detectLang, I18nContext } from './i18n';
import { getTelegram, initTelegram } from './telegram';
import './styles.css';

initTelegram();

const tg = getTelegram();
const forcedLang = new URLSearchParams(window.location.search).get('lang');
const lang = detectLang(
  forcedLang ?? tg?.initDataUnsafe?.user?.language_code ?? navigator.language,
);
document.documentElement.lang = lang;
if (tg) document.documentElement.dataset.telegram = 'true';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');

createRoot(root).render(
  <StrictMode>
    <I18nContext.Provider value={createTranslator(lang)}>
      <App />
    </I18nContext.Provider>
  </StrictMode>,
);
