import { CloseCode, type ServerMessage } from '@ai-office/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeStore } from '../src/core.js';
import type { Env } from '../src/env.js';
import { Office } from '../src/office.js';
import { MemoryOfficeStore } from './memory-store.js';

const T0 = Date.parse('2026-11-19T10:00:00.000Z');

/** Server-side socket double: records what the Durable Object sends and how it closes. */
class FakeSocket {
  sent: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  private attachment: unknown = null;
  constructor(readonly tag: string) {}
  send(data: string) {
    if (this.closed) throw new Error('closed');
    this.sent.push(JSON.parse(data) as ServerMessage);
  }
  close(code: number, reason: string) {
    this.closed ??= { code, reason };
  }
  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

class FakeState {
  sockets: FakeSocket[] = [];
  acceptWebSocket(ws: FakeSocket, tags: string[]) {
    expect(tags).toEqual([ws.tag]);
    this.sockets.push(ws);
  }
  getWebSockets(tag: string) {
    return this.sockets.filter((s) => s.tag === tag && !s.closed);
  }
}

class TestOffice extends Office {
  protected override createStore(): OfficeStore {
    return new MemoryOfficeStore();
  }
}

function setup() {
  const state = new FakeState();
  const office = new TestOffice(state as unknown as DurableObjectState, {} as Env);
  const connect = (role: 'collector' | 'viewer', sessionExpMs: number | null = null) => {
    const ws = new FakeSocket(role);
    office.acceptSocket(ws as unknown as WebSocket, role, sessionExpMs);
    return ws;
  };
  const sendSnapshot = (ws: FakeSocket, status: 'idle' | 'working') =>
    office.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({
        type: 'snapshot',
        snapshot: {
          v: 2,
          generatedAt: new Date(Date.now()).toISOString(),
          agents: [
            {
              id: 'coordinator',
              name: 'Coordinator',
              role: 'Main assistant',
              room: 'hq',
              kind: 'llm',
              status,
              activity: null,
              lastActivityAt: null,
              model: null,
              usageToday: null,
              cron: [],
            },
          ],
          quotas: [],
          host: null,
        },
      }),
    );
  return { office, connect, sendSnapshot };
}

describe('Office Durable Object', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends the state to a new viewer and broadcasts collector updates', async () => {
    const { connect, sendSnapshot } = setup();
    const viewer = connect('viewer', T0 + 60_000);
    expect(viewer.sent.map((m) => m.type)).toEqual(['state']);

    const collector = connect('collector');
    await sendSnapshot(collector, 'working');
    const last = viewer.sent.at(-1);
    expect(last?.type).toBe('state');
    expect(last?.type === 'state' && last.state.snapshot?.agents[0]?.status).toBe('working');
    // Only full state messages are broadcast; new events are part of the state.
    expect(viewer.sent.every((m) => m.type === 'state')).toBe(true);
  });

  it('closes viewer sockets whose session expired', async () => {
    const { connect, sendSnapshot, office } = setup();
    const viewer = connect('viewer', T0 + 1000);
    const collector = connect('collector');

    vi.setSystemTime(T0 + 2000);
    await sendSnapshot(collector, 'working');
    expect(viewer.closed?.code).toBe(CloseCode.SessionExpired);

    const late = connect('viewer', T0 + 3000);
    vi.setSystemTime(T0 + 4000);
    await office.webSocketMessage(late as unknown as WebSocket, 'hello');
    expect(late.closed?.code).toBe(CloseCode.SessionExpired);
  });

  it('replaces an older collector with a dedicated close code', () => {
    const { connect } = setup();
    const first = connect('collector');
    const second = connect('collector');
    expect(first.closed?.code).toBe(CloseCode.Replaced);
    expect(second.closed).toBeNull();
  });

  it('closes a collector after repeated invalid messages and logs only schema paths', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { connect, office } = setup();
    const collector = connect('collector');
    for (let i = 0; i < 3; i++) {
      await office.webSocketMessage(
        collector as unknown as WebSocket,
        JSON.stringify({ type: 'heartbeat', at: 'secret-looking-value' }),
      );
    }
    expect(collector.closed?.code).toBe(CloseCode.PolicyViolation);
    expect(warn).toHaveBeenCalledWith('collector message rejected', 'at: invalid_string');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-looking-value');
  });

  it('ignores viewer messages (no execution path)', async () => {
    const { connect, office } = setup();
    const viewer = connect('viewer', T0 + 60_000);
    await office.webSocketMessage(viewer as unknown as WebSocket, '{"type":"command"}');
    expect(viewer.sent).toHaveLength(1);
    expect(viewer.closed).toBeNull();
  });
});
