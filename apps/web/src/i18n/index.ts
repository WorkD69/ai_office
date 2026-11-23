import { createContext, useContext } from 'react';
import { en, type MessageKey } from './en';
import { ru } from './ru';

export type Lang = 'en' | 'ru';
export type { MessageKey };

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, ru };

/** ru for Russian, Ukrainian and Belarusian users (Russian UI is closer than English for them). */
export function detectLang(languageCode: string | undefined): Lang {
  const code = (languageCode ?? '').toLowerCase().slice(0, 2);
  return code === 'ru' || code === 'uk' || code === 'be' ? 'ru' : 'en';
}

/**
 * The live office belongs to its owner, who reads Russian; the public demo is for visitors and
 * speaks English. `?lang=` (any value {@link detectLang} understands) overrides both.
 */
export function chooseLang(forced: string | null, mode: 'live' | 'demo'): Lang {
  if (forced) return detectLang(forced);
  return mode === 'live' ? 'ru' : 'en';
}

export interface Translator {
  lang: Lang;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

/** True if `key` exists in the dictionaries (for keys built from protocol values). */
export function isMessageKey(key: string): key is MessageKey {
  return key in en;
}

export function createTranslator(lang: Lang): Translator {
  const dict = DICTS[lang];
  return {
    lang,
    t: (key, vars) => {
      const template = dict[key] ?? en[key];
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
    },
  };
}

export const dictionaries = DICTS;

export const I18nContext = createContext<Translator>(createTranslator('en'));

export function useI18n(): Translator {
  return useContext(I18nContext);
}

/** Room ids are free-form; known ones get a translated label, unknown ones are title-cased. */
export function roomLabel(tr: Translator, roomId: string): string {
  const key = `room.${roomId}`;
  if (isMessageKey(key)) return tr.t(key);
  return roomId.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
