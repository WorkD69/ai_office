import { SNAPSHOT_STALE_AFTER_MS, type OfficeState } from '@ai-office/protocol';

export type Freshness =
  | { kind: 'fresh' }
  | { kind: 'collector_offline'; ageMs: number | null }
  | { kind: 'stale'; ageMs: number };

/**
 * Is what the office shows still current? A dead exporter must be visible: the relay refuses to
 * forward old snapshots, and the UI flags both a silent collector and an old snapshot.
 */
export function freshness(state: OfficeState | null, now: number): Freshness {
  if (!state) return { kind: 'fresh' };
  const generated = state.snapshot ? Date.parse(state.snapshot.generatedAt) : NaN;
  const ageMs = Number.isNaN(generated) ? null : Math.max(0, now - generated);
  if (!state.collectorOnline) return { kind: 'collector_offline', ageMs };
  if (ageMs !== null && ageMs > SNAPSHOT_STALE_AFTER_MS) return { kind: 'stale', ageMs };
  return { kind: 'fresh' };
}
