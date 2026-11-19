import { describe, expect, it } from 'vitest';
import { createSession, verifySession } from '../src/auth/session.js';

const SECRET = 'unit-test-session-secret-0123456789';
const NOW = 1_795_000_000;

describe('session tokens', () => {
  it('round-trips claims', async () => {
    const { token, payload } = await createSession(SECRET, { sub: '4242', role: 'owner' }, NOW, 60);
    expect(payload).toEqual({ sub: '4242', role: 'owner', exp: NOW + 60 });
    expect(await verifySession(SECRET, token, NOW + 1)).toEqual(payload);
  });

  it('rejects expired tokens', async () => {
    const { token } = await createSession(SECRET, { sub: '4242', role: 'owner' }, NOW, 60);
    expect(await verifySession(SECRET, token, NOW + 60)).toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const { token } = await createSession(
      'another-secret-value-xxxxxxxxxxxx',
      { sub: '4242', role: 'owner' },
      NOW,
    );
    expect(await verifySession(SECRET, token, NOW)).toBeNull();
  });

  it('rejects a tampered payload (privilege escalation attempt)', async () => {
    const { token } = await createSession(SECRET, { sub: '4242', role: 'viewer' }, NOW);
    const [, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: '4242', role: 'owner', exp: NOW + 999 }),
    ).toString('base64url');
    expect(await verifySession(SECRET, `${forged}.${signature}`, NOW)).toBeNull();
  });

  it('rejects garbage', async () => {
    for (const bad of ['', 'abc', 'a.b.c', '!!.??', 'x'.repeat(2000)]) {
      expect(await verifySession(SECRET, bad, NOW)).toBeNull();
    }
  });
});
