import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Snapshot } from '../src/index.js';

/**
 * Cross-language contract: golden snapshots produced by the Python collector's tests (from
 * synthetic fixtures) must satisfy the zod schema the worker uses. `snapshot-max.json` pushes
 * every free-text field to its length limit, so truncation bugs on either side fail here.
 */
const GOLDEN = ['snapshot.json', 'snapshot-max.json'];

describe('collector contract', () => {
  it.each(GOLDEN)('%s from the Python collector matches the zod schema', (name) => {
    const path = fileURLToPath(
      new URL(`../../../apps/collector/tests/golden/${name}`, import.meta.url),
    );
    const parsed = Snapshot.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) throw new Error(`${name}: ${parsed.error.message}`);
    expect(parsed.data.agents.length).toBeGreaterThan(0);
  });
});
