import { describe, expect, it } from 'vitest';
import { createTranslator, detectLang, dictionaries, roomLabel } from '../src/i18n';

describe('i18n', () => {
  it('en and ru have exactly the same keys and no empty strings', () => {
    const en = Object.keys(dictionaries.en).sort();
    const ru = Object.keys(dictionaries.ru).sort();
    expect(ru).toEqual(en);
    for (const dict of Object.values(dictionaries)) {
      for (const value of Object.values(dict)) expect(value.trim()).not.toBe('');
    }
  });

  it('keeps the same {placeholders} in both languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(dictionaries.en) as Array<keyof typeof dictionaries.en>) {
      expect(vars(dictionaries.ru[key])).toEqual(vars(dictionaries.en[key]));
    }
  });

  it('detects Russian for ru/uk/be and falls back to English', () => {
    expect(detectLang('ru-RU')).toBe('ru');
    expect(detectLang('uk')).toBe('ru');
    expect(detectLang('be')).toBe('ru');
    expect(detectLang('de')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });

  it('interpolates variables and labels rooms', () => {
    const tr = createTranslator('en');
    expect(tr.t('scene.label', { count: 7 })).toContain('7');
    expect(roomLabel(tr, 'hq')).toBe('HQ');
    expect(roomLabel(createTranslator('ru'), 'server')).toBe('Серверная');
    expect(roomLabel(tr, 'night-shift')).toBe('Night shift');
  });
});
