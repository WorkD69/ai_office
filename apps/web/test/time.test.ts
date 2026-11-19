import { describe, expect, it } from 'vitest';
import { formatCompact, formatRelative } from '../src/lib/time';
import { backoffDelay } from '../src/data/live';
import { detectMode } from '../src/data/useOffice';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();

describe('formatRelative', () => {
  it('handles missing and invalid dates', () => {
    expect(formatRelative(null, NOW, 'en', 'just now')).toBeNull();
    expect(formatRelative('nope', NOW, 'en', 'just now')).toBeNull();
  });

  it('says "just now" for the last ~45 seconds', () => {
    expect(formatRelative(ago(10), NOW, 'en', 'just now')).toBe('just now');
  });

  it('uses minutes, hours and days in the past and future', () => {
    expect(formatRelative(ago(5 * 60), NOW, 'en', 'x')).toBe('5 min. ago');
    expect(formatRelative(ago(3 * 3600), NOW, 'en', 'x')).toBe('3 hr. ago');
    expect(formatRelative(ago(-2 * 3600), NOW, 'en', 'x')).toBe('in 2 hr.');
    expect(formatRelative(ago(2 * 86400), NOW, 'en', 'x')).toBe('2 days ago');
  });

  it('never rounds up into the next unit and never says "0 min"', () => {
    expect(formatRelative(ago(23.6 * 3600), NOW, 'en', 'x')).toBe('23 hr. ago');
    expect(formatRelative(ago(50), NOW, 'en', 'x')).toBe('1 min. ago');
    expect(formatRelative(ago(119), NOW, 'en', 'x')).toBe('1 min. ago');
    expect(formatRelative(ago(-50), NOW, 'en', 'x')).toBe('in 1 min.');
    expect(formatRelative(ago(-(47 * 3600 + 59 * 60)), NOW, 'en', 'x')).toBe('tomorrow');
  });

  it('localises to Russian', () => {
    expect(formatRelative(ago(5 * 60), NOW, 'ru', 'x')).toMatch(/5 мин/);
  });
});

describe('helpers', () => {
  it('formats compact numbers', () => {
    expect(formatCompact(15_300, 'en')).toBe('15.3K');
  });

  it('backoff grows exponentially and is capped at 30s', () => {
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(backoffDelay(3, () => 1)).toBe(8_000);
    expect(backoffDelay(20, () => 1)).toBe(30_000);
  });

  it('demo mode is used outside Telegram or when ?demo is set', () => {
    expect(detectMode('', null)).toEqual({ mode: 'demo' });
    expect(detectMode('', '')).toEqual({ mode: 'demo' });
    expect(detectMode('', 'query_id=1')).toEqual({ mode: 'live', initData: 'query_id=1' });
    expect(detectMode('?demo=1', 'query_id=1')).toEqual({ mode: 'demo' });
  });
});
