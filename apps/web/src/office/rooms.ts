/**
 * Room themes: rooms differ by floor and furniture (Pixel Agents art); the accent colour is
 * used only on the room sign (docs/design.md).
 */
import type { FurnitureId } from './furniture';
import { hash32 } from './hash';
import type { Hsbc } from './pixels';

/** Floor tiles shipped in public/pixel-agents/v1.6.0/floors. */
export type FloorTile = 0 | 1 | 3 | 4 | 5 | 6 | 7;
export const FLOOR_TILES: readonly FloorTile[] = [0, 1, 3, 4, 5, 6, 7];

/** One sprite of a decor group, offset in tiles from the group's top-left. */
export interface DecorPart {
  id: FurnitureId;
  dx: number;
  dy: number;
  mirror?: boolean;
}

/**
 * A decor candidate. `x` counts tiles from the room's left edge, or from its right edge when
 * negative (-1 = last column). On the floor, `y` counts from the top, or from the bottom when
 * `fromBottom`. Wall decor always sits in the 2-tile wall band. Candidates are tried in
 * order and skipped when they do not fit or would touch a desk.
 */
export interface DecorSpec {
  x: number;
  y: number;
  fromBottom?: boolean;
  /** A decorative zone (rack, coffee corner, big plant): only in rooms with a decor strip. */
  zone?: boolean;
  /** Footprint in tiles. */
  w: number;
  h: number;
  parts: readonly DecorPart[];
}

export interface RoomTheme {
  /** Sign accent (the only place the room colour is used). */
  accent: string;
  floor: { tile: FloorTile; colour: Hsbc };
  wall: readonly DecorSpec[];
  floorDecor: readonly DecorSpec[];
}

const one = (
  id: FurnitureId,
  x: number,
  y: number,
  w: number,
  h: number,
  fromBottom = false,
): DecorSpec => ({ x, y, w, h, fromBottom, parts: [{ id, dx: 0, dy: 0 }] });

const wall = (id: FurnitureId, x: number, w = 1): DecorSpec => one(id, x, 0, w, 2);

/** A server rack made of a side desk with two side-facing computers on it. */
const RACK: DecorSpec = {
  zone: true,
  x: -1,
  y: 0,
  w: 1,
  h: 4,
  parts: [
    { id: 'DESK_SIDE', dx: 0, dy: 0 },
    { id: 'PC_SIDE', dx: 0, dy: 0, mirror: true },
    { id: 'PC_SIDE', dx: 0, dy: 2, mirror: true },
  ],
};

const COFFEE_CORNER: DecorSpec = {
  zone: true,
  x: -1,
  y: 1,
  fromBottom: true,
  w: 1,
  h: 3,
  parts: [
    { id: 'SMALL_TABLE_SIDE', dx: 0, dy: 0 },
    { id: 'COFFEE', dx: 0, dy: 1 },
  ],
};

const THEMES: Readonly<Record<string, RoomTheme>> = {
  hq: {
    accent: '#f2b84b',
    floor: { tile: 6, colour: { h: 25, s: 48, b: -43, c: -88 } },
    wall: [wall('HANGING_PLANT', -1), wall('CLOCK', -2), wall('DOUBLE_BOOKSHELF', -4, 2)],
    floorDecor: [one('PLANT', -1, 1, 1, 2), one('PLANT_2', -1, 1, 1, 2, true)],
  },
  opportunities: {
    accent: '#86df7c',
    floor: { tile: 3, colour: { h: 95, s: 20, b: -30, c: -75 } },
    wall: [wall('WHITEBOARD', -2, 2), wall('SMALL_PAINTING_2', -1), wall('HANGING_PLANT', -3)],
    floorDecor: [one('CACTUS', -1, 1, 1, 2), one('PLANT', -1, 1, 1, 2, true)],
  },
  trading: {
    accent: '#79bcff',
    floor: { tile: 0, colour: { h: 209, s: 39, b: -25, c: -80 } },
    wall: [wall('LARGE_PAINTING', -2, 2), wall('SMALL_PAINTING', -1), wall('SMALL_PAINTING_2', -3)],
    floorDecor: [one('PLANT_2', -1, 1, 1, 2), one('CACTUS', -1, 1, 1, 2, true)],
  },
  community: {
    accent: '#dba5f5',
    floor: { tile: 5, colour: { h: 285, s: 18, b: -38, c: -80 } },
    wall: [wall('SMALL_PAINTING', -1), wall('CLOCK', -2), wall('SMALL_PAINTING_2', -3)],
    floorDecor: [one('PLANT', -1, 1, 1, 2), one('BIN', -1, 1, 1, 1, true)],
  },
  server: {
    accent: '#7ee0ff',
    floor: { tile: 7, colour: { h: 230, s: 8, b: -40, c: -70 } },
    wall: [wall('DOUBLE_BOOKSHELF', -2, 2), wall('HANGING_PLANT', -1), wall('HANGING_PLANT', -3)],
    floorDecor: [RACK, one('PLANT_2', -1, 1, 1, 2), one('BIN', -1, 1, 1, 1, true)],
  },
  dev: {
    accent: '#5fe3c9',
    floor: { tile: 4, colour: { h: 175, s: 20, b: -34, c: -78 } },
    wall: [wall('WHITEBOARD', -2, 2), wall('CLOCK', -1), wall('CLOCK', -3)],
    floorDecor: [one('PLANT', -1, 1, 1, 2), COFFEE_CORNER],
  },
  content: {
    accent: '#ffd27a',
    floor: { tile: 1, colour: { h: 35, s: 30, b: -30, c: -75 } },
    wall: [wall('LARGE_PAINTING', -2, 2), wall('CLOCK', -1), wall('CLOCK', -3)],
    floorDecor: [one('PLANT', -1, 1, 1, 2), one('PLANT_2', -1, 1, 1, 2, true)],
  },
  lounge: {
    accent: '#ff9fb2',
    floor: { tile: 6, colour: { h: 345, s: 22, b: -40, c: -85 } },
    wall: [wall('SMALL_PAINTING', -1), wall('LARGE_PAINTING', -3, 2)],
    floorDecor: [{ ...one('LARGE_PLANT', -2, 1, 2, 3), zone: true }, one('PLANT', -1, 1, 1, 2)],
  },
};

const FALLBACK: readonly RoomTheme[] = [
  {
    accent: '#b9a6ff',
    floor: { tile: 3, colour: { h: 255, s: 18, b: -32, c: -76 } },
    wall: [wall('SMALL_PAINTING', -1), wall('CLOCK', -2)],
    floorDecor: [one('PLANT', -1, 1, 1, 2)],
  },
  {
    accent: '#ffc38a',
    floor: { tile: 5, colour: { h: 30, s: 35, b: -36, c: -82 } },
    wall: [wall('HANGING_PLANT', -1), wall('SMALL_PAINTING_2', -2)],
    floorDecor: [one('PLANT_2', -1, 1, 1, 2)],
  },
  {
    accent: '#8ae0ff',
    floor: { tile: 4, colour: { h: 195, s: 22, b: -34, c: -78 } },
    wall: [wall('WHITEBOARD', -2, 2), wall('CLOCK', -1)],
    floorDecor: [one('CACTUS', -1, 1, 1, 2)],
  },
];

/** Theme of a room; ids come from data, so only own keys count ('constructor' is a room too). */
export function roomTheme(roomId: string): RoomTheme {
  if (Object.hasOwn(THEMES, roomId)) return THEMES[roomId] as RoomTheme;
  return FALLBACK[hash32(roomId) % FALLBACK.length] as RoomTheme;
}

/** Every theme (for preloading the floors they use). */
export function allThemes(): RoomTheme[] {
  return [...Object.values(THEMES), ...FALLBACK];
}
