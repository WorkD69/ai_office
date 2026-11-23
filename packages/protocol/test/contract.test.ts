import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Agent, PROTOCOL_VERSION, REASON_PARAM_MAX, ReasonCode, Snapshot } from '../src/index.js';

/**
 * Cross-language contract: golden snapshots produced by the Python collector's tests (from
 * synthetic fixtures) must satisfy the zod schema the worker uses. `snapshot-max.json` pushes
 * every free-text field to its length limit, so truncation bugs on either side fail here.
 */
const GOLDEN = ['snapshot.json', 'snapshot-max.json'];

function golden(name: string): unknown {
  const path = fileURLToPath(
    new URL(`../../../apps/collector/tests/golden/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('collector contract', () => {
  it.each(GOLDEN)('%s from the Python collector matches the zod schema', (name) => {
    const parsed = Snapshot.safeParse(golden(name));
    if (!parsed.success) throw new Error(`${name}: ${parsed.error.message}`);
    expect(parsed.data.v).toBe(PROTOCOL_VERSION);
    expect(parsed.data.agents.length).toBeGreaterThan(0);
  });

  it.each(GOLDEN)('%s spells out every agent field (no reliance on schema defaults)', (name) => {
    const raw = golden(name) as { agents: Record<string, unknown>[] };
    const fields = Object.keys(Agent.shape).sort();
    for (const agent of raw.agents) expect(Object.keys(agent).sort()).toEqual(fields);
  });

  it('carries the manual-config description and chat link through to the snapshot', () => {
    const parsed = Snapshot.parse(golden('snapshot.json'));
    const described = parsed.agents.filter((a) => a.summary !== null && a.chatUrl !== null);
    expect(described.length).toBeGreaterThan(0);
    expect(parsed.quotas.length).toBeGreaterThan(0);
  });
});

describe('status reasons from the Python collector', () => {
  it.each(GOLDEN)('%s sends only reason codes the protocol lists', (name) => {
    const parsed = Snapshot.parse(golden(name));
    const reasons = parsed.agents.flatMap((a) => (a.reason ? [a.reason] : []));
    expect(reasons.length).toBeGreaterThan(0);
    for (const r of reasons) expect(ReasonCode.options).toContain(r.code);
  });

  it('keeps the collector text out of activity when it sends a reason', () => {
    const parsed = Snapshot.parse(golden('snapshot.json'));
    const failed = parsed.agents.find((a) => a.reason?.code === 'unit_failed');
    expect(failed).toMatchObject({ status: 'error', activity: null });
    expect(failed?.reason?.params).toEqual({ unit: 'broker' });
  });

  it('cuts long reason params exactly at the limit', () => {
    const parsed = Snapshot.parse(golden('snapshot-max.json'));
    const down = parsed.agents.find((a) => a.reason?.code === 'unit_down');
    expect(down?.reason?.params.unit?.length).toBe(REASON_PARAM_MAX);
    expect(down?.reason?.params.unit?.endsWith('…')).toBe(true);
  });
});

describe('chat link cases shared with the Python collector', () => {
  const path = fileURLToPath(new URL('./fixtures/chat-urls.json', import.meta.url));
  const cases = JSON.parse(readFileSync(path, 'utf8')) as { valid: string[]; invalid: string[] };

  it.each(cases.valid)('accepts %j', (url) => {
    expect(Agent.shape.chatUrl.safeParse(url).success).toBe(true);
  });

  it.each(cases.invalid)('rejects %j', (url) => {
    expect(Agent.shape.chatUrl.safeParse(url).success).toBe(false);
  });
});

describe('collector length limits count UTF-16 units like zod', () => {
  it('snapshot-max.json carries emoji text exactly at the limits', () => {
    const parsed = Snapshot.parse(golden('snapshot-max.json'));
    const emoji = parsed.agents.find((a) => a.summary?.includes('\u{1F642}'));
    expect(emoji?.summary?.length).toBe(120);
    expect(emoji?.project?.length).toBe(48);
  });
});
