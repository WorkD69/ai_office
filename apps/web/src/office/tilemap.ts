/**
 * Tile map of the office: floors, walls and the void between them. Walls use Pixel Agents'
 * auto-tiling (a 4-bit mask of wall neighbours N=1, E=2, S=4, W=8 picks one of 16 pieces in
 * walls/wall_0.png; each piece is 16x32 and drawn one tile up, so a wall row looks 2 tiles high).
 */
import type { OfficeLayout } from './layout';

export const VOID = 0;
export const WALL = 1;
/** Floor cells hold FLOOR + index of the room in `layout.rooms`. */
export const FLOOR = 2;

export interface TileMap {
  w: number;
  h: number;
  cells: Uint8Array;
}

export function buildTileMap(layout: OfficeLayout): TileMap {
  const w = layout.tilesW;
  const h = layout.tilesH;
  const cells = new Uint8Array(w * h);
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < w && r < h;
  layout.rooms.forEach((room, index) => {
    for (let r = room.ty; r < room.ty + room.th; r++) {
      for (let c = room.tx; c < room.tx + room.tw; c++)
        if (inside(c, r)) cells[r * w + c] = FLOOR + index;
    }
  });
  const isFloor = (c: number, r: number) => inside(c, r) && (cells[r * w + c] ?? 0) >= FLOOR;
  const wall = (c: number, r: number) => {
    if (inside(c, r) && !isFloor(c, r)) cells[r * w + c] = WALL;
  };
  for (const room of layout.rooms) {
    for (let c = room.tx - 1; c <= room.tx + room.tw; c++) wall(c, room.ty - 1);
    for (let r = room.ty - 1; r < room.ty + room.th; r++) {
      wall(room.tx - 1, r);
      wall(room.tx + room.tw, r);
    }
  }
  return { w, h, cells };
}

export function cellAt(map: TileMap, c: number, r: number): number {
  if (c < 0 || r < 0 || c >= map.w || r >= map.h) return VOID;
  return map.cells[r * map.w + c] ?? VOID;
}

/** Wall auto-tile mask: N=1, E=2, S=4, W=8 for wall neighbours. */
export function wallMask(map: TileMap, c: number, r: number): number {
  const isWall = (cc: number, rr: number) => cellAt(map, cc, rr) === WALL;
  return (
    (isWall(c, r - 1) ? 1 : 0) |
    (isWall(c + 1, r) ? 2 : 0) |
    (isWall(c, r + 1) ? 4 : 0) |
    (isWall(c - 1, r) ? 8 : 0)
  );
}
