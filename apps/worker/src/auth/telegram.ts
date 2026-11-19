import { hmacSha256, timingSafeEqual, toHex, utf8 } from '../crypto.js';

/**
 * Server-side validation of Telegram Mini App `initData`.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   data_check_string = all fields except `hash`, sorted by key, "key=value" joined by "\n"
 *   secret_key        = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   hash              = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
 */

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export type InitDataResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; reason: 'malformed' | 'invalid' | 'expired' };

/**
 * initData older than this is rejected even if the signature is valid. Kept short so a leaked
 * initData string cannot be exchanged for sessions for long. Telegram issues fresh initData every
 * time the Mini App is opened; a long-lived open app keeps working through its session token and
 * only needs reopening if it has to log in again after this window.
 */
export const INIT_DATA_MAX_AGE_SECONDS = 60 * 60;
/** Tolerated clock skew for auth_date values in the future. */
export const INIT_DATA_MAX_SKEW_SECONDS = 60;

export async function validateInitData(
  initData: string,
  botToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<InitDataResult> {
  if (!initData || initData.length > 4096) return { ok: false, reason: 'malformed' };

  const params = new URLSearchParams(initData);
  const fields = new Map<string, string>();
  for (const [key, value] of params) {
    if (fields.has(key)) return { ok: false, reason: 'malformed' };
    fields.set(key, value);
  }

  const hash = fields.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: 'malformed' };
  fields.delete('hash');

  const dataCheckString = [...fields.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmacSha256('WebAppData', botToken);
  const expected = toHex(await hmacSha256(secretKey, dataCheckString));
  if (!timingSafeEqual(utf8(expected), utf8(hash))) return { ok: false, reason: 'invalid' };

  // Only trust the payload after the signature check.
  const authDate = Number(fields.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, reason: 'malformed' };
  if (authDate > nowSeconds + INIT_DATA_MAX_SKEW_SECONDS) return { ok: false, reason: 'invalid' };
  if (nowSeconds - authDate > INIT_DATA_MAX_AGE_SECONDS) return { ok: false, reason: 'expired' };

  const user = parseUser(fields.get('user'));
  if (!user) return { ok: false, reason: 'malformed' };
  return { ok: true, user, authDate };
}

function parseUser(raw: string | undefined): TelegramUser | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const id = (value as { id?: unknown }).id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
    return value as TelegramUser;
  } catch {
    return null;
  }
}
