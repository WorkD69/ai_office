import { describe, expect, it } from 'vitest';
import {
  chooseGrid,
  hitTest,
  layoutOffice,
  LOUNGE,
  planRooms,
  type Placeable,
  type Rect,
} from '../src/office/layout';

const ROSTER: Placeable[] = [
  { id: 'coordinator', room: 'hq' },
  { id: 'hunter', room: 'opportunities' },
  { id: 'crypto', room: 'trading' },
  { id: 'community-bot', room: 'community' },
  { id: 'news', room: 'community' },
  { id: 'watchdog', room: 'server' },
  { id: 'archivist', room: 'server' },
  { id: 'cc-1', room: 'dev' },
  { id: 'cc-2', room: 'dev' },
  { id: 'extra', room: 'research' },
];

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('planRooms', () => {
  it('orders known rooms canonically, appends unknown rooms and closes with the lounge', () => {
    const ids = planRooms(ROSTER).map((r) => r.id);
    expect(ids).toEqual([
      'hq',
      'opportunities',
      'trading',
      'community',
      'server',
      'dev',
      'content',
      'research',
      LOUNGE,
    ]);
  });

  it('adds placeholder desks for the future content team', () => {
    const content = planRooms(ROSTER).find((r) => r.id === 'content');
    expect(content?.agentIds).toEqual([]);
    expect(content?.futureDesks).toBeGreaterThan(0);
  });
});

describe('layoutOffice', () => {
  for (const cols of [1, 2, 3, 4, 5]) {
    it(`gives every agent a desk without overlaps (cols=${cols})`, () => {
      const layout = layoutOffice(ROSTER, cols);
      const bounds = { x: 0, y: 0, w: layout.width, h: layout.height };

      expect([...layout.seats.keys()].sort()).toEqual(ROSTER.map((a) => a.id).sort());
      for (const room of layout.rooms) {
        expect(inside(room, bounds)).toBe(true);
        for (const desk of room.desks) expect(inside(desk, room)).toBe(true);
        for (const d of room.decor) expect(inside(d, room)).toBe(true);
      }
      const rooms = layout.rooms;
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          expect(overlaps(rooms[i] as Rect, rooms[j] as Rect)).toBe(false);
        }
      }
      const desks = rooms.flatMap((r) => r.desks);
      for (let i = 0; i < desks.length; i++) {
        for (let j = i + 1; j < desks.length; j++) {
          expect(overlaps(desks[i] as Rect, desks[j] as Rect)).toBe(false);
        }
      }
    });
  }

  it('is stable: input order does not change seating', () => {
    const a = layoutOffice(ROSTER, 3);
    const b = layoutOffice([...ROSTER].reverse(), 3);
    for (const [id, desk] of a.seats) {
      expect(b.seats.get(id)).toMatchObject({ x: desk.x, y: desk.y });
    }
  });
});

describe('chooseGrid', () => {
  it('fits the whole office into a desktop viewport with an integer scale', () => {
    const viewport = { width: 1040, height: 860, dpr: 1 };
    const { layout, scale } = chooseGrid(ROSTER, viewport, 'fit');
    expect(Number.isInteger(scale)).toBe(true);
    expect(scale).toBeGreaterThanOrEqual(2);
    expect(layout.width * scale).toBeLessThanOrEqual(viewport.width);
    expect(layout.height * scale).toBeLessThanOrEqual(viewport.height);
  });

  it('uses two rows and fits the height on phones', () => {
    const viewport = { width: 390, height: 380, dpr: 3 };
    const { layout, scale } = chooseGrid(ROSTER, viewport, 'scroll');
    expect(layout.rooms.length / layout.cols).toBeLessThanOrEqual(2);
    expect(layout.height * scale).toBeLessThanOrEqual(viewport.height * viewport.dpr);
  });
});

describe('hitTest', () => {
  it('finds the agent at the centre of its desk and nothing in the hallway', () => {
    const layout = layoutOffice(ROSTER, 3);
    const desk = layout.seats.get('crypto');
    expect(desk).toBeDefined();
    expect(hitTest(layout, desk!.x + desk!.w / 2, desk!.y + desk!.h / 2)).toBe('crypto');
    expect(hitTest(layout, 1, 1)).toBeNull();
  });
});
