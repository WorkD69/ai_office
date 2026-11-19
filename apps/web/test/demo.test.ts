import { describe, expect, it } from 'vitest';
import { OfficeState } from '@ai-office/protocol';
import { createDemoOffice, DEMO_TICK_MS, mulberry32 } from '../src/data/demo';

const START = Date.parse('2026-11-19T10:00:00.000Z');

describe('demo office', () => {
  it('always produces protocol-valid state', () => {
    const demo = createDemoOffice(START);
    for (let i = 0; i < 300; i++) {
      const state = demo.tick(START + i * DEMO_TICK_MS);
      const parsed = OfficeState.safeParse(state);
      if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3)));
    }
  });

  it('is alive: statuses change and an approval eventually shows up in the inbox', () => {
    const demo = createDemoOffice(START);
    const statuses = new Set<string>();
    let sawApproval = false;
    for (let i = 0; i < 300; i++) {
      const state = demo.tick(START + i * DEMO_TICK_MS);
      state.snapshot?.agents.forEach((a) => statuses.add(a.status));
      sawApproval ||= state.inbox.some((item) => item.kind === 'approval');
    }
    expect(statuses.size).toBeGreaterThanOrEqual(4);
    expect(sawApproval).toBe(true);
  });

  it('starts with a non-empty feed and a failed cron job in the inbox', () => {
    const state = createDemoOffice(START).tick(START);
    expect(state.feed.length).toBeGreaterThan(0);
    expect(state.inbox.some((i) => i.kind === 'cron_failed')).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = createDemoOffice(START, { seed: 3 }).tick(START);
    const b = createDemoOffice(START, { seed: 3 }).tick(START);
    expect(a).toEqual(b);
  });

  it('showcase mode starts with every status on screen', () => {
    const state = createDemoOffice(START, { showcase: true }).tick(START);
    const statuses = new Set(state.snapshot?.agents.map((a) => a.status));
    for (const s of ['working', 'waiting_you', 'waiting_external', 'error', 'idle', 'offline']) {
      expect(statuses.has(s as never)).toBe(true);
    }
    expect(state.inbox[0]?.kind).toBe('approval');
  });

  it('mulberry32 stays in [0, 1)', () => {
    const r = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
