import { describe, expect, it } from 'vitest';
import {
  chooseGrid,
  FLOOR_PAD_TOP,
  hitTest,
  layoutOffice,
  LOUNGE,
  planRooms,
  ROOM_TILES,
  ROOM_TILES_WIDE,
  SIGN_TILES,
  SLOT_H,
  slotTiles,
  TILE,
  WALL_TILES,
  type Placeable,
  type Rect,
} from '../src/office/layout';
import { buildTileMap, cellAt, FLOOR, VOID, WALL, wallMask } from '../src/office/tilemap';

/** The demo roster (apps/web/src/data/demo.ts): 9 agents in 6 rooms. */
const DEMO: Placeable[] = [
  { id: 'coordinator', room: 'hq' },
  { id: 'opportunity-hunter', room: 'opportunities' },
  { id: 'crypto-analyst', room: 'trading' },
  { id: 'community-bot', room: 'community' },
  { id: 'news-worker', room: 'community' },
  { id: 'watchdog', room: 'server' },
  { id: 'archivist', room: 'server' },
  { id: 'claude-code-1', room: 'dev' },
  { id: 'claude-code-2', room: 'dev' },
];

const PHONE = { width: 390, height: 844, dpr: 3 };
/** Scene area of a 1440x900 laptop: minus the 392 px panel and the demo banner. */
const LAPTOP = { width: 1440 - 392 - 2, height: 900 - 27, dpr: 1 };

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('planRooms', () => {
  it('orders known rooms canonically and appends unknown rooms; no empty rooms', () => {
    const ids = planRooms([...DEMO, { id: 'x', room: 'research' }]).map((r) => r.id);
    expect(ids).toEqual([
      'hq',
      'opportunities',
      'trading',
      'community',
      'server',
      'dev',
      'research',
    ]);
  });

  it('keeps the lounge last, and only when somebody sits there', () => {
    expect(planRooms(DEMO).some((r) => r.id === LOUNGE)).toBe(false);
    const ids = planRooms([{ id: 'a', room: LOUNGE }, ...DEMO]).map((r) => r.id);
    expect(ids.at(-1)).toBe(LOUNGE);
  });
});

describe('layoutOffice', () => {
  for (const cols of [1, 2, 3, 4, 5]) {
    for (const tiles of [ROOM_TILES, ROOM_TILES_WIDE]) {
      it(`gives every agent a desk without overlaps (cols=${cols}, room=${tiles})`, () => {
        const layout = layoutOffice(DEMO, cols, tiles);
        const bounds = { x: 0, y: 0, w: layout.width, h: layout.height };
        expect([...layout.seats.keys()].sort()).toEqual(DEMO.map((a) => a.id).sort());
        for (const room of layout.rooms) {
          expect(inside(room, bounds)).toBe(true);
          expect(room.ty).toBeGreaterThanOrEqual(WALL_TILES);
          for (const desk of room.desks) expect(inside(desk, room)).toBe(true);
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
  }

  it('sizes rooms by desk count: one desk row per desk in a one-column room', () => {
    const layout = layoutOffice(
      [
        { id: 'a', room: 'hq' },
        { id: 'b', room: 'dev' },
        { id: 'c', room: 'dev' },
        { id: 'd', room: 'dev' },
      ],
      1,
    );
    const [hq, dev] = layout.rooms;
    expect(hq?.th).toBe(FLOOR_PAD_TOP + SLOT_H);
    expect(dev?.th).toBe(FLOOR_PAD_TOP + 3 * SLOT_H);
  });

  it('on two columns a big room takes the whole row with desks in rows of 2', () => {
    const team = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, room: 'server' }));
    const layout = layoutOffice([{ id: 'z', room: 'hq' }, ...team], 2);
    const server = layout.rooms.find((r) => r.id === 'server');
    expect(server?.tw).toBe(layout.tilesW);
    expect(server?.th).toBe(FLOOR_PAD_TOP + 3 * SLOT_H);
    const rowsOfDesks = new Set(server?.desks.map((d) => d.ty));
    expect(rowsOfDesks.size).toBe(3);
    // The lonely room before it stretches over the free cell: no holes in the grid.
    expect(layout.rooms[0]?.tw).toBe(layout.tilesW);
  });

  it('rooms in a grid row share the height of the tallest one', () => {
    const layout = layoutOffice(DEMO, 2);
    const trading = layout.rooms.find((r) => r.id === 'trading');
    const community = layout.rooms.find((r) => r.id === 'community');
    expect(trading?.ty).toBe(community?.ty);
    expect(trading?.th).toBe(community?.th);
    expect(community?.th).toBe(FLOOR_PAD_TOP + 2 * SLOT_H);
  });

  it('keeps decor off desk slots and wall decor right of the sign', () => {
    for (const tiles of [ROOM_TILES, ROOM_TILES_WIDE]) {
      const layout = layoutOffice(DEMO, 3, tiles);
      for (const room of layout.rooms) {
        const taken = new Set(
          room.desks.flatMap((d) => slotTiles(d, room)).map(([x, y]) => `${x},${y}`),
        );
        for (const d of room.decor) {
          expect(d.tx).toBeGreaterThanOrEqual(room.tx);
          expect(d.tx + d.tw).toBeLessThanOrEqual(room.tx + room.tw);
          if (d.layer === 'wall') {
            expect(d.ty).toBe(room.ty - WALL_TILES);
            expect(d.tx - room.tx).toBeGreaterThanOrEqual(SIGN_TILES);
            continue;
          }
          for (let y = 0; y < d.th; y++) {
            for (let x = 0; x < d.tw; x++) {
              expect(taken.has(`${d.tx - room.tx + x},${d.ty - room.ty + y}`)).toBe(false);
            }
          }
        }
      }
    }
  });

  it('is stable: input order does not change seating', () => {
    const a = layoutOffice(DEMO, 3);
    const b = layoutOffice([...DEMO].reverse(), 3);
    for (const [id, desk] of a.seats) {
      expect(b.seats.get(id)).toMatchObject({ x: desk.x, y: desk.y });
    }
  });

  it('measures everything in whole 16 px tiles', () => {
    const layout = layoutOffice(DEMO, 2);
    expect(layout.width).toBe(layout.tilesW * TILE);
    expect(layout.height).toBe(layout.tilesH * TILE);
    for (const desk of layout.seats.values()) expect((desk.x % TILE) + (desk.y % TILE)).toBe(0);
  });
});

describe('chooseGrid', () => {
  it('phone 390 px: 2 columns, the largest integer scale, no horizontal overflow', () => {
    const { layout, scale } = chooseGrid(DEMO, PHONE, 'scroll');
    expect(layout.cols).toBe(2);
    expect(layout.roomTiles).toBe(ROOM_TILES);
    expect(Number.isInteger(scale)).toBe(true);
    expect(scale).toBe(6); // 2 CSS px per art pixel at DPR 3
    expect(layout.width * scale).toBeLessThanOrEqual(PHONE.width * PHONE.dpr);
    expect(layout.width * (scale + 1)).toBeGreaterThan(PHONE.width * PHONE.dpr);
  });

  it('phone: the office may be taller than the screen (it scrolls down only)', () => {
    const { layout, scale } = chooseGrid(DEMO, PHONE, 'scroll');
    expect(layout.tilesH).toBe(29);
    expect(layout.height * scale).toBeGreaterThan(PHONE.height * PHONE.dpr * 0.5);
  });

  it('phone 360 px at DPR 2 also stays in 2 columns without overflow', () => {
    const viewport = { width: 360, height: 700, dpr: 2 };
    const { layout, scale } = chooseGrid(DEMO, viewport, 'scroll');
    expect(layout.cols).toBe(2);
    expect(layout.width * scale).toBeLessThanOrEqual(viewport.width * viewport.dpr);
  });

  it('laptop 1440x900: 3 columns at 3x with decor strips, the whole office fits', () => {
    const { layout, scale } = chooseGrid(DEMO, LAPTOP, 'fit');
    expect(layout.cols).toBe(3);
    expect(scale).toBe(3);
    expect(layout.roomTiles).toBe(ROOM_TILES_WIDE);
    expect(layout.width * scale).toBeLessThanOrEqual(LAPTOP.width);
    expect(layout.height * scale).toBeLessThanOrEqual(LAPTOP.height);
  });

  it('fit: a huge office keeps 2x and scrolls down instead of shrinking to 1x', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, room: `r${i % 8}` }));
    const viewport = { width: 1046, height: 700, dpr: 1 };
    const { layout, scale } = chooseGrid(many, viewport, 'fit');
    expect(scale).toBe(2);
    expect(layout.width * scale).toBeLessThanOrEqual(viewport.width);
  });

  it('copes with an empty office', () => {
    const { layout, scale } = chooseGrid([], PHONE, 'scroll');
    expect(layout.rooms).toEqual([]);
    expect(scale).toBeGreaterThanOrEqual(1);
  });
});

describe('tile map', () => {
  it('puts a wall row above every floor and a wall between neighbouring rooms', () => {
    const layout = layoutOffice(DEMO, 2);
    const map = buildTileMap(layout);
    for (const room of layout.rooms) {
      for (let c = room.tx; c < room.tx + room.tw; c++) {
        expect(cellAt(map, c, room.ty - 1)).toBe(WALL);
        expect(cellAt(map, c, room.ty)).toBeGreaterThanOrEqual(FLOOR);
      }
    }
    const [hq, opp] = layout.rooms;
    expect(opp!.tx - (hq!.tx + hq!.tw)).toBe(1);
    expect(cellAt(map, hq!.tx + hq!.tw, hq!.ty + 1)).toBe(WALL);
    // The row above a wall row is left empty: the 16x32 wall pieces cover it.
    expect(cellAt(map, 0, 0)).toBe(VOID);
  });

  it('auto-tiles walls by their wall neighbours', () => {
    const layout = layoutOffice(DEMO, 2);
    const map = buildTileMap(layout);
    const hq = layout.rooms[0]!;
    const sep = hq.tx + hq.tw;
    // A separator in the middle of a floor: walls above and below only.
    expect(wallMask(map, sep, hq.ty + 2)).toBe(1 | 4);
    // The top wall left of the separator: walls east and west.
    expect(wallMask(map, 1, hq.ty - 1)).toBe(2 | 8);
  });
});

describe('hostile room ids', () => {
  it('lays out rooms named like Object.prototype members', () => {
    const odd = ['constructor', '__proto__', 'toString'].map((room, i) => ({ id: `a${i}`, room }));
    const layout = layoutOffice(odd, 2);
    expect(layout.rooms.map((r) => r.id).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(layout.seats.size).toBe(3);
  });
});

describe('hitTest', () => {
  it('finds the agent in its desk slot and nothing on a wall', () => {
    const layout = layoutOffice(DEMO, 3);
    const desk = layout.seats.get('crypto-analyst');
    expect(desk).toBeDefined();
    expect(hitTest(layout, desk!.x + desk!.w / 2, desk!.y + desk!.h / 2)).toBe('crypto-analyst');
    expect(hitTest(layout, 1, 1)).toBeNull();
  });
});
