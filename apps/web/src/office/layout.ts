/**
 * Pure layout engine: agents -> rooms -> desks, in logical pixels.
 * No DOM here, so it is fully unit-tested.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DecorKind =
  'plant' | 'bookshelf' | 'rack' | 'coffee' | 'cooler' | 'sofa' | 'table' | 'lamp' | 'rug';

export type WallItemKind =
  'window' | 'quota' | 'chart' | 'whiteboard' | 'clock' | 'poster' | 'vent';

export interface Desk extends Rect {
  roomId: string;
  agentId: string | null;
  /** Placeholder desk for a team that does not exist yet. */
  future: boolean;
}

export interface Decor extends Rect {
  kind: DecorKind;
}

export interface WallItem extends Rect {
  kind: WallItemKind;
}

export interface RoomLayout extends Rect {
  id: string;
  desks: Desk[];
  decor: Decor[];
  wall: WallItem[];
}

export interface OfficeLayout {
  width: number;
  height: number;
  cols: number;
  rooms: RoomLayout[];
  /** agentId -> desk */
  seats: Map<string, Desk>;
}

export interface Placeable {
  id: string;
  room: string;
}

// Logical-pixel metrics. One logical pixel = one art pixel.
export const ROOM_W = 152;
export const WALL_H = 30;
export const SIGN_H = 14;
export const DESK_W = 48;
export const DESK_H = 44;
export const DESKS_PER_ROW = 2;
export const ROOM_PAD = 8;
export const ROOM_PAD_BOTTOM = 6;
export const GAP = 8;
export const MARGIN = 10;

/** Canonical room order; unknown rooms follow alphabetically, the lounge closes the grid. */
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
export const FUTURE_ROOM = 'content';
const FUTURE_DESKS = 2;

interface RoomPlan {
  id: string;
  agentIds: string[];
  futureDesks: number;
}

/** Groups agents into rooms in a stable order (agents sorted by id inside a room). */
export function planRooms(agents: readonly Placeable[]): RoomPlan[] {
  const byRoom = new Map<string, string[]>();
  for (const a of agents) {
    const list = byRoom.get(a.room) ?? [];
    list.push(a.id);
    byRoom.set(a.room, list);
  }
  const known = ROOM_ORDER.filter((id) => byRoom.has(id) || id === FUTURE_ROOM);
  const unknown = [...byRoom.keys()]
    .filter((id) => !ROOM_ORDER.includes(id) && id !== LOUNGE)
    .sort();
  const plans = [...known, ...unknown].map((id) => {
    const agentIds = [...(byRoom.get(id) ?? [])].sort();
    return {
      id,
      agentIds,
      futureDesks: id === FUTURE_ROOM && agentIds.length === 0 ? FUTURE_DESKS : 0,
    };
  });
  plans.push({ id: LOUNGE, agentIds: [...(byRoom.get(LOUNGE) ?? [])].sort(), futureDesks: 0 });
  return plans;
}

function deskRows(plan: RoomPlan): number {
  return Math.max(1, Math.ceil((plan.agentIds.length + plan.futureDesks) / DESKS_PER_ROW));
}

function roomHeight(plan: RoomPlan): number {
  return WALL_H + SIGN_H + deskRows(plan) * DESK_H + ROOM_PAD_BOTTOM;
}

export function layoutOffice(agents: readonly Placeable[], cols: number): OfficeLayout {
  const plans = planRooms(agents);
  const columns = Math.max(1, Math.min(cols, plans.length));
  const gridRows = Math.ceil(plans.length / columns);

  const rowHeights: number[] = [];
  for (let row = 0; row < gridRows; row++) {
    const inRow = plans.slice(row * columns, row * columns + columns);
    rowHeights.push(Math.max(...inRow.map(roomHeight)));
  }

  const rooms: RoomLayout[] = [];
  const seats = new Map<string, Desk>();
  let y = MARGIN;
  plans.forEach((plan, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    if (col === 0 && row > 0) y += (rowHeights[row - 1] ?? 0) + GAP;
    const x = MARGIN + col * (ROOM_W + GAP);
    const h = rowHeights[row] ?? roomHeight(plan);
    // The last room (the lounge) stretches over any empty grid cells, so no hole is left.
    const isLast = index === plans.length - 1;
    const w = isLast ? (columns - col) * (ROOM_W + GAP) - GAP : ROOM_W;
    const room = buildRoom(plan, { x, y, w, h });
    for (const desk of room.desks) if (desk.agentId) seats.set(desk.agentId, desk);
    rooms.push(room);
  });

  const width = MARGIN * 2 + columns * ROOM_W + (columns - 1) * GAP;
  const height = MARGIN * 2 + rowHeights.reduce((s, h) => s + h, 0) + (gridRows - 1) * GAP;
  return { width, height, cols: columns, rooms, seats };
}

function buildRoom(plan: RoomPlan, rect: Rect): RoomLayout {
  const floorTop = rect.y + WALL_H + SIGN_H;
  const slots = [
    ...plan.agentIds.map((agentId) => ({ agentId, future: false })),
    ...Array.from({ length: plan.futureDesks }, () => ({ agentId: null, future: true })),
  ];
  const desks: Desk[] = slots.map((slot, i) => ({
    roomId: plan.id,
    agentId: slot.agentId,
    future: slot.future,
    x: rect.x + ROOM_PAD + (i % DESKS_PER_ROW) * DESK_W,
    y: floorTop + Math.floor(i / DESKS_PER_ROW) * DESK_H,
    w: DESK_W,
    h: DESK_H,
  }));
  return {
    id: plan.id,
    ...rect,
    desks,
    decor: decorFor(plan.id, rect, floorTop),
    wall: wallFor(plan.id, rect),
  };
}

/** Furniture lives in the right-hand strip of each room (the lounge uses the whole floor). */
function decorFor(roomId: string, room: Rect, floorTop: number): Decor[] {
  const stripX = room.x + ROOM_PAD + DESKS_PER_ROW * DESK_W + 8;
  const bottom = room.y + room.h - ROOM_PAD_BOTTOM;
  const at = (kind: DecorKind, w: number, h: number, dx = 0, fromBottom = false): Decor => ({
    kind,
    w,
    h,
    x: stripX + dx,
    y: fromBottom ? bottom - h : floorTop - 6,
  });
  switch (roomId) {
    case 'hq':
      return [at('bookshelf', 22, 28, 1), at('plant', 12, 13, 6, true)];
    case 'opportunities':
      return [at('plant', 12, 13, 6), at('lamp', 8, 22, 8, true)];
    case 'trading':
      return [at('cooler', 10, 20, 7), at('plant', 12, 13, 6, true)];
    case 'community':
      return [at('bookshelf', 22, 28, 1), at('plant', 12, 13, 6, true)];
    case 'server':
      return [at('rack', 14, 32, 0), at('rack', 14, 32, 14)];
    case 'dev':
      return [at('coffee', 12, 18, 6), at('plant', 12, 13, 6, true)];
    case LOUNGE: {
      const cx = room.x + Math.floor(room.w / 2);
      const right = room.x + room.w - ROOM_PAD;
      const items: Decor[] = [
        { kind: 'rug', x: cx - 36, y: floorTop - 2, w: 72, h: 38 },
        { kind: 'sofa', x: cx - 24, y: floorTop + 2, w: 48, h: 16 },
        { kind: 'table', x: cx - 12, y: floorTop + 23, w: 24, h: 10 },
        { kind: 'plant', x: room.x + ROOM_PAD, y: bottom - 13, w: 12, h: 13 },
        { kind: 'coffee', x: right - 12, y: floorTop - 4, w: 12, h: 18 },
        { kind: 'plant', x: right - 12, y: bottom - 13, w: 12, h: 13 },
      ];
      // Wide lounges get a reading corner.
      if (room.w >= ROOM_W * 2) {
        items.push(
          { kind: 'bookshelf', x: right - 44, y: floorTop - 6, w: 22, h: 28 },
          { kind: 'lamp', x: room.x + ROOM_PAD + 90, y: bottom - 22, w: 8, h: 22 },
        );
      }
      return items;
    }
    default:
      return [at('plant', 12, 13, 6)];
  }
}

function wallFor(roomId: string, room: Rect): WallItem[] {
  const y = room.y + 6;
  const win = (dx: number): WallItem => ({ kind: 'window', x: room.x + dx, y, w: 20, h: 16 });
  const lastWin = room.w - 36;
  switch (roomId) {
    case 'hq':
      return [
        { kind: 'quota', x: room.x + 8, y: room.y + 5, w: 56, h: 20 },
        { kind: 'clock', x: room.x + 76, y: room.y + 9, w: 10, h: 10 },
        win(lastWin),
      ];
    case 'trading':
      return [{ kind: 'chart', x: room.x + 8, y: room.y + 5, w: 72, h: 20 }, win(lastWin)];
    case 'dev':
      return [{ kind: 'whiteboard', x: room.x + 8, y: room.y + 5, w: 52, h: 20 }, win(lastWin)];
    case 'server':
      return [
        { kind: 'vent', x: room.x + 12, y: room.y + 8, w: 24, h: 12 },
        { kind: 'vent', x: room.x + 44, y: room.y + 8, w: 24, h: 12 },
        { kind: 'vent', x: room.x + 76, y: room.y + 8, w: 24, h: 12 },
      ];
    case 'content':
      return [
        { kind: 'poster', x: room.x + 12, y: room.y + 6, w: 18, h: 18 },
        win(64),
        win(lastWin),
      ];
    default: {
      // Evenly spaced windows; works for stretched rooms too.
      const count = Math.max(1, Math.floor((room.w - 16) / 46));
      const step = (room.w - 20) / count;
      return Array.from({ length: count }, (_, i) => win(Math.round(step / 2 + i * step)));
    }
  }
}

/**
 * Picks the column count and integer device-pixel scale for a viewport.
 * - `fit`:    the whole office must fit; maximise the scale.
 * - `scroll`: narrow screens; fit the height with at most 2 grid rows and scroll sideways.
 */
export function chooseGrid(
  agents: readonly Placeable[],
  viewport: { width: number; height: number; dpr: number },
  mode: 'fit' | 'scroll',
): { layout: OfficeLayout; scale: number } {
  const roomCount = planRooms(agents).length;
  const devW = viewport.width * viewport.dpr;
  const devH = viewport.height * viewport.dpr;
  let best: { layout: OfficeLayout; scale: number; fill: number } | null = null;

  const candidates =
    mode === 'scroll'
      ? [Math.ceil(roomCount / 2)]
      : Array.from({ length: Math.min(roomCount, 5) }, (_, i) => i + 1);

  for (const cols of candidates) {
    const layout = layoutOffice(agents, cols);
    const raw =
      mode === 'scroll'
        ? devH / layout.height
        : Math.min(devW / layout.width, devH / layout.height);
    const scale = Math.max(1, Math.floor(raw));
    const fill = (layout.width * layout.height * scale * scale) / Math.max(1, devW * devH);
    if (!best || scale > best.scale || (scale === best.scale && fill > best.fill)) {
      best = { layout, scale, fill };
    }
  }
  // `candidates` is never empty, so `best` is always set.
  return { layout: best!.layout, scale: best!.scale };
}

/** Logical point -> the agent whose desk area contains it. */
export function hitTest(layout: OfficeLayout, x: number, y: number): string | null {
  for (const [agentId, desk] of layout.seats) {
    if (x >= desk.x && x < desk.x + desk.w && y >= desk.y && y < desk.y + desk.h) return agentId;
  }
  return null;
}
