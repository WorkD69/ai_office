import { createHmac } from 'node:crypto';

export const BOT_TOKEN = '123456789:TEST-token-for-unit-tests-only';
export const OWNER_ID = 4242;

/**
 * Builds Mini App initData exactly as Telegram does, using node:crypto as an
 * independent reference implementation of the algorithm.
 */
export function signInitData(fields: Record<string, string>, botToken: string = BOT_TOKEN): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

export function initDataFor(userId: number, authDate: number, botToken?: string): string {
  return signInitData(
    {
      auth_date: String(authDate),
      query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
      user: JSON.stringify({ id: userId, first_name: 'Test', username: 'tester' }),
    },
    botToken,
  );
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
