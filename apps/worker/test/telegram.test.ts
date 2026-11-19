import { describe, expect, it } from 'vitest';
import { INIT_DATA_MAX_AGE_SECONDS, validateInitData } from '../src/auth/telegram.js';
import { BOT_TOKEN, initDataFor, signInitData } from './helpers.js';

const NOW = 1_795_000_000;

describe('validateInitData', () => {
  it('accepts initData signed with the bot token', async () => {
    const result = await validateInitData(initDataFor(4242, NOW - 10), BOT_TOKEN, NOW);
    expect(result).toMatchObject({
      ok: true,
      authDate: NOW - 10,
      user: { id: 4242, username: 'tester' },
    });
  });

  it('rejects initData signed with another bot token', async () => {
    const result = await validateInitData(initDataFor(4242, NOW, '1:other-bot'), BOT_TOKEN, NOW);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects tampered fields', async () => {
    const tampered = initDataFor(4242, NOW).replace(
      encodeURIComponent('"id":4242'),
      encodeURIComponent('"id":1'),
    );
    expect(tampered).not.toBe(initDataFor(4242, NOW));
    expect(await validateInitData(tampered, BOT_TOKEN, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('accepts initData up to one hour old and rejects it afterwards', async () => {
    expect(INIT_DATA_MAX_AGE_SECONDS).toBe(3600);
    const fresh = initDataFor(4242, NOW - INIT_DATA_MAX_AGE_SECONDS);
    expect(await validateInitData(fresh, BOT_TOKEN, NOW)).toMatchObject({ ok: true });
    const stale = initDataFor(4242, NOW - INIT_DATA_MAX_AGE_SECONDS - 1);
    expect(await validateInitData(stale, BOT_TOKEN, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects stale and future auth_date', async () => {
    expect(await validateInitData(initDataFor(4242, NOW - 25 * 3600), BOT_TOKEN, NOW)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(await validateInitData(initDataFor(4242, NOW + 3600), BOT_TOKEN, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects malformed input', async () => {
    const noHash = new URLSearchParams({ auth_date: String(NOW), user: '{"id":1}' }).toString();
    expect(await validateInitData(noHash, BOT_TOKEN, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(await validateInitData('', BOT_TOKEN, NOW)).toEqual({ ok: false, reason: 'malformed' });
    const duplicate = `${initDataFor(4242, NOW)}&auth_date=${NOW}`;
    expect(await validateInitData(duplicate, BOT_TOKEN, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('requires a valid user object even when the signature is valid', async () => {
    const noUser = signInitData({ auth_date: String(NOW), query_id: 'q' });
    expect(await validateInitData(noUser, BOT_TOKEN, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});
