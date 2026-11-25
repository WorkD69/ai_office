/**
 * Pure layout engine on a 16 px tile grid: agents -> rooms -> desks and decor.
 * Coordinates: `tx`/`ty`/`tw`/`th` in tiles, `x`/`y`/`w`/`h` in art pixels. No DOM here.
 *
 * A room is a floor rectangle with a 2-tile wall band above it; rooms in a grid row are
 * separated by a 1-tile wall. Each desk sits in a 5x4-tile slot: desk and computer on top,
 * the chair under them, the name plate on the last row.
 */
import { FURNITURE } from './furniture';
import { roomTheme, type DecorPart, type DecorSpec } from './rooms';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TILE = 16;
/** Wall band above every floor. */
export const WALL_TILES = 2;
/** Desk slot. */
export const SLOT_W = 5;
export const SLOT_H = 4;
/** Free floor row between the wall and the first desks. */
export const FLOOR_PAD_TOP = 1;
/** Width of a one-column room: one desk slot. */
export const ROOM_TILES = 5;
/** A one-column room with a decor strip, used only when it costs no scale. */
export const ROOM_TILES_WIDE = 6;
/** Rooms with this many agents take a whole grid row (rows of desks side by side). */
export const SPAN_FROM = 3;
/** Wall tiles on the left of every room kept clear for the room sign. */
export const SIGN_TILES = 3;
/** Most columns the desktop layout tries. */
const MAX_COLS = 5;

/** Canonical room order; unknown rooms follow alphabetically, the lounge comes last. */
export const ROOM_ORDER = [
  'hq',
  'opportunities',
  'trading',
  'community',
  'server',
  'dev',
  'content',
];
export const LOUNGE = 'lounge';

export interface Desk extends Rect {
  roomId: string;
  agentId: string;
  /** Top-left tile of the desk slot. */
  tx: number;
  ty: number;
}

export interface PlacedDecor {
  layer: 'wall' | 'floor';
  tx: number;
  ty: number;
  tw: number;
  th: number;
  parts: readonly DecorPart[];
}

export interface RoomLayout extends Rect {
  id: string;
  /** Floor rectangle in tiles (the wall band is the 2 rows above `ty`). */
  tx: number;
  ty: number;
  tw: number;
  th: number;
  desks: Desk[];
  decor: PlacedDecor[];
}

export interface OfficeLayout {
  width: number;
  height: number;
  tilesW: number;
  tilesH: number;
  cols: number;
  roomTiles: number;
  rooms: RoomLayout[];
  /** agentId -> desk */
  seats: Map<string, Desk>;
}

export interface Placeable {
  id: string;
  room: string;
}

export interface RoomPlan {
  id: string;
  agentIds: string[];
}

/** Groups agents into rooms in a stable order; only rooms with agents exist. */
export function planRooms(agents: readonly Placeable[]): RoomPlan[] {
  const byRoom = new Map<string, string[]>();
  for (const a of agents) {
    const list = byRoom.get(a.room) ?? [];
    list.push(a.id);
    byRoom.set(a.room, list);
  }
  const known = ROOM_ORDER.filter((id) => byRoom.has(id));
  const unknown = [...byRoom.keys()]
    .filter((id) => !ROOM_ORDER.includes(id) && id !== LOUNGE)
    .sort();
  const ids = [...known, ...unknown, ...(byRoom.has(LOUNGE) ? [LOUNGE] : [])];
  return ids.map((id) => ({ id, agentIds: [...(byRoom.get(id) ?? [])].sort() }));
}

/** Desks side by side in a room `tw` tiles wide. */
export function desksPerRow(tw: number): number {
  return Math.max(1, Math.floor(tw / SLOT_W));
}

/** Floor height in tiles for `count` desks in a room `tw` tiles wide. */
export function floorTiles(count: number, tw: number): number {
  return FLOOR_PAD_TOP + Math.max(1, Math.ceil(count / desksPerRow(tw))) * SLOT_H;
}

interface Cell {
  plan: RoomPlan;
  col: number;
  span: number;
}

/** Packs rooms into grid rows; a big room gets a row of its own, the last room in a row fills it. */
function packRows(plans: readonly RoomPlan[], columns: number): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  const close = () => {
    if (row.length === 0) return;
    const last = row[row.length - 1] as Cell;
    last.span = columns - last.col;
    rows.push(row);
    row = [];
  };
  for (const plan of plans) {
    if (columns > 1 && plan.agentIds.length >= SPAN_FROM) {
      close();
      rows.push([{ plan, col: 0, span: columns }]);
      continue;
    }
    row.push({ plan, col: row.length, span: 1 });
    if (row.length === columns) close();
  }
  close();
  return rows;
}

export function layoutOffice(
  agents: readonly Placeable[],
  cols: number,
  roomTiles: number = ROOM_TILES,
): OfficeLayout {
  const plans = planRooms(agents);
  // More columns than rooms is fine: the last room of a grid row stretches over the rest.
  const columns = Math.max(1, cols);
  const rooms: RoomLayout[] = [];
  const seats = new Map<string, Desk>();
  let ty = WALL_TILES;
  for (const row of packRows(plans, columns)) {
    const width = (cell: Cell) => cell.span * roomTiles + (cell.span - 1);
    const th = Math.max(...row.map((cell) => floorTiles(cell.plan.agentIds.length, width(cell))));
    for (const cell of row) {
      const room = buildRoom(cell.plan, cell.col * (roomTiles + 1), ty, width(cell), th);
      for (const desk of room.desks) seats.set(desk.agentId, desk);
      rooms.push(room);
    }
    ty += th + WALL_TILES;
  }
  const tilesW = columns * roomTiles + (columns - 1);
  const tilesH = plans.length === 0 ? WALL_TILES : ty - WALL_TILES;
  return {
    width: tilesW * TILE,
    height: tilesH * TILE,
    tilesW,
    tilesH,
    cols: columns,
    roomTiles,
    rooms,
    seats,
  };
}

function buildRoom(plan: RoomPlan, tx: number, ty: number, tw: number, th: number): RoomLayout {
  const perRow = desksPerRow(tw);
  const desks: Desk[] = plan.agentIds.map((agentId, i) => {
    const stx = tx + (i % perRow) * SLOT_W;
    const sty = ty + FLOOR_PAD_TOP + Math.floor(i / perRow) * SLOT_H;
    return {
      roomId: plan.id,
      agentId,
      tx: stx,
      ty: sty,
      x: stx * TILE,
      y: sty * TILE,
      w: SLOT_W * TILE,
      h: SLOT_H * TILE,
    };
  });
  const room: RoomLayout = {
    id: plan.id,
    tx,
    ty,
    tw,
    th,
    x: tx * TILE,
    y: ty * TILE,
    w: tw * TILE,
    h: th * TILE,
    desks,
    decor: [],
  };
  room.decor = placeDecor(room);
  return room;
}

/** Tiles (room-relative) taken by a desk slot: desk, chair and person, plus the plate row. */
export function slotTiles(desk: Desk, room: RoomLayout): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const sx = desk.tx - room.tx;
  const sy = desk.ty - room.ty;
  for (let y = 0; y < SLOT_H; y++) {
    for (let x = 0; x < SLOT_W; x++) {
      if (y === SLOT_H - 1 || (x >= 1 && x <= 3)) out.push([sx + x, sy + y]);
    }
  }
  return out;
}

function placeDecor(room: RoomLayout): PlacedDecor[] {
  const theme = roomTheme(room.id);
  const placed: PlacedDecor[] = [];
  const left = (spec: DecorSpec) => (spec.x < 0 ? room.tw + spec.x : spec.x);

  // Wall band: right of the sign, no overlaps.
  const wallUsed = new Set<number>();
  for (const spec of theme.wall) {
    const x = left(spec);
    if (x < SIGN_TILES || x + spec.w > room.tw) continue;
    const cols = Array.from({ length: spec.w }, (_, i) => x + i);
    if (cols.some((c) => wallUsed.has(c))) continue;
    cols.forEach((c) => wallUsed.add(c));
    placed.push({
      layer: 'wall',
      tx: room.tx + x,
      ty: room.ty - WALL_TILES,
      tw: spec.w,
      th: spec.h,
      parts: spec.parts,
    });
  }

  // Floor: only on tiles no desk slot uses.
  const used = new Set<string>();
  for (const desk of room.desks) for (const [x, y] of slotTiles(desk, room)) used.add(`${x},${y}`);
  for (const spec of theme.floorDecor) {
    const x = left(spec);
    const y = spec.fromBottom ? room.th - spec.h - spec.y : spec.y;
    if (x < 0 || y < 0 || x + spec.w > room.tw || y + spec.h > room.th) continue;
    const tiles: string[] = [];
    for (let dy = 0; dy < spec.h; dy++)
      for (let dx = 0; dx < spec.w; dx++) tiles.push(`${x + dx},${y + dy}`);
    if (tiles.some((t) => used.has(t))) continue;
    tiles.forEach((t) => used.add(t));
    placed.push({
      layer: 'floor',
      tx: room.tx + x,
      ty: room.ty + y,
      tw: spec.w,
      th: spec.h,
      parts: spec.parts,
    });
  }
  return placed;
}

/** Pixel size of a furniture sprite (tiles x 16). */
export function spriteSize(id: keyof typeof FURNITURE): { w: number; h: number } {
  const f = FURNITURE[id];
  return { w: f.w * TILE, h: f.h * TILE };
}

export interface Viewport {
  /** CSS pixels. */
  width: number;
  height: number;
  dpr: number;
}

/**
 * Backing-canvas limits. Big canvases fail silently (a blank scene) or eat memory on budget
 * phones, so we stay at half the 16.7 MP (4096x4096) area limit of iOS Safari and well under
 * the side limits of current browsers. Above them the device-pixel multiplier goes down
 * (the art scale on screen stays the same, the pixels just get coarser).
 */
export const MAX_CANVAS_AREA = 8_388_608;
export const MAX_CANVAS_SIDE = 8192;

export interface Grid {
  layout: OfficeLayout;
  /** Integer CSS pixels per art pixel the grid was chosen for. */
  scale: number;
  /** Integer device pixels per art pixel in the backing canvas. */
  deviceScale: number;
  /** CSS pixels per art pixel the canvas is shown at (keeps device pixels whole). */
  cssPerArt: number;
}

/**
 * Backing resolution for an art scale: device pixels per art pixel must be whole for crisp
 * pixels, so `scale x dpr` is rounded (down when rounding up would overflow `fit`), and the
 * CSS size follows it. Then the multiplier is lowered until the canvas is within the limits.
 */
export function backingFor(
  layout: Pick<OfficeLayout, 'width' | 'height'>,
  scale: number,
  viewport: Viewport,
  mode: 'fit' | 'scroll',
): { deviceScale: number; cssPerArt: number } {
  const exact = scale * viewport.dpr;
  const fits = (device: number) => {
    const css = device / viewport.dpr;
    if (layout.width * css > viewport.width) return false;
    return mode === 'scroll' || layout.height * css <= viewport.height;
  };
  const up = Math.max(1, Math.round(exact));
  const ideal = fits(up) ? up : Math.max(1, Math.floor(exact));
  const cssPerArt = ideal / viewport.dpr;
  let deviceScale = ideal;
  const tooBig = (d: number) =>
    layout.width * d > MAX_CANVAS_SIDE ||
    layout.height * d > MAX_CANVAS_SIDE ||
    layout.width * layout.height * d * d > MAX_CANVAS_AREA;
  while (deviceScale > 1 && tooBig(deviceScale)) deviceScale--;
  return { deviceScale, cssPerArt };
}

/**
 * Picks columns, room width and the integer CSS scale from the CSS size of the area (the
 * grid does not depend on the device pixel ratio), then the backing resolution.
 * - `scroll` (phones): 2 columns that fill the width; the office scrolls down, never sideways.
 * - `fit` (laptops): the largest scale at which the whole office fits; if that is below 2x,
 *   keep 2x and let the office scroll down.
 * The wider rooms (with a decor strip) win only when they cost no scale.
 */
export function chooseGrid(
  agents: readonly Placeable[],
  viewport: Viewport,
  mode: 'fit' | 'scroll',
): Grid {
  const roomCount = Math.max(1, planRooms(agents).length);
  const areaW = Math.floor(viewport.width);
  const areaH = Math.floor(viewport.height);
  const colsList =
    mode === 'scroll'
      ? [2]
      : Array.from({ length: Math.min(roomCount, MAX_COLS) }, (_, i) => i + 1);
  const options = colsList.flatMap((cols) =>
    [ROOM_TILES, ROOM_TILES_WIDE].map((tiles) => layoutOffice(agents, cols, tiles)),
  );
  const widthScale = (l: OfficeLayout) => Math.floor(areaW / l.width);

  type Choice = { layout: OfficeLayout; scale: number; rank: number[] };
  const best = (picks: Choice[]): Choice | undefined =>
    picks.sort((a, b) => {
      for (let i = 0; i < a.rank.length; i++) {
        const d = (b.rank[i] ?? 0) - (a.rank[i] ?? 0);
        if (d !== 0) return d;
      }
      return 0;
    })[0];
  const finish = (c: Choice): Grid => ({
    layout: c.layout,
    scale: c.scale,
    ...backingFor(c.layout, c.scale, viewport, mode),
  });

  if (mode === 'scroll') {
    const pick = best(
      options.map((layout) => {
        const scale = Math.max(1, widthScale(layout));
        return { layout, scale, rank: [scale, layout.roomTiles] };
      }),
    ) as Choice;
    return finish(pick);
  }

  const fitted = best(
    options.map((layout) => {
      const scale = Math.max(1, Math.min(widthScale(layout), Math.floor(areaH / layout.height)));
      const area = layout.width * layout.height * scale * scale;
      return { layout, scale, rank: [scale, layout.roomTiles, area] };
    }),
  ) as Choice;
  const minScale = 2;
  if (fitted.scale >= minScale) return finish(fitted);
  // Too big to fit at 2x: keep 2x and scroll down; prefer the layout with the fewest rows
  // that still fits the width.
  const wide = options.filter((l) => l.width * minScale <= areaW);
  const pick = best(
    wide.map((layout) => ({ layout, scale: minScale, rank: [-layout.height, layout.roomTiles] })),
  );
  return finish(pick ?? fitted);
}

/** Logical point -> the agent whose desk slot contains it. */
export function hitTest(layout: OfficeLayout, x: number, y: number): string | null {
  for (const [agentId, desk] of layout.seats) {
    if (x >= desk.x && x < desk.x + desk.w && y >= desk.y && y < desk.y + desk.h) return agentId;
  }
  return null;
}
