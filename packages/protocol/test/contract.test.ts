import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Agent, PROTOCOL_VERSION, Snapshot } from '../src/index.js';

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
