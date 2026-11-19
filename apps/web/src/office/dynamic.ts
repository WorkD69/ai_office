/**
 * Per-frame drawing: people, status effects, live wall screens and text.
 * All coordinates are logical pixels; the caller applies the integer device scale.
 */
import type { AgentStatus, Quota } from '@ai-office/protocol';
import type { Desk, OfficeLayout, Rect, RoomLayout, WallItem } from './layout';
import { box, px, rackLeds } from './props';
import { rasterize } from './raster';
import { roomStyle, SCENE } from './roomStyles';
import { BASE_PALETTE, CHAIR, characterVariant, DESK, MONITOR } from './sprites';
import { signRect } from './background';
import { hash32 } from './hash';

type Ctx = CanvasRenderingContext2D;

export interface SceneAgent {
  id: string;
  name: string;
  status: AgentStatus;
  activity: string | null;
}

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export const STATUS_COLOURS: Readonly<Record<AgentStatus, string>> = {
  working: '#6cd46c',
  waiting_you: '#ffd24a',
  waiting_external: '#79bcff',
  error: '#ff5a5f',
  idle: '#b9b2c6',
  offline: '#5d566b',
};

export function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  opts: {
    size?: number;
    colour?: string;
    weight?: number;
    align?: CanvasTextAlign;
    maxWidth?: number;
  } = {},
): void {
  const { size = 6, colour = SCENE.white, weight = 700, align = 'left', maxWidth } = opts;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.fillText(maxWidth ? ellipsize(ctx, value, maxWidth) : value, x, y);
}

export function ellipsize(ctx: Ctx, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${value.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${value.slice(0, lo)}…`;
}

// ---------------------------------------------------------------- desks & people

/** Figures are drawn on a 40px-wide grid centred inside the desk cell. */
function figureOrigin(desk: Desk): { x: number; y: number } {
  return { x: desk.x + Math.floor((desk.w - 40) / 2), y: desk.y };
}

export function drawDesk(
  ctx: Ctx,
  desk: Desk,
  agent: SceneAgent | undefined,
  t: number,
  futureLabel: string,
): void {
  const { x, y } = figureOrigin(desk);
  const style = roomStyle(desk.roomId);
  const present = !!agent && agent.status !== 'offline';

  px(ctx, 'rgba(43,33,53,0.18)', x + 4, y + 29, 34, 2);
  ctx.drawImage(rasterize(CHAIR, BASE_PALETTE, 'chair'), x + 13, y + 9);

  if (agent && present) {
    const v = characterVariant(agent.id);
    const bob = agent.status === 'idle' && Math.floor(t / 900) % 2 === 1 ? 1 : 0;
    ctx.drawImage(rasterize(v.template, v.palette, v.key), x + 14, y + 4 + bob);
    if (agent.status === 'waiting_you') {
      const wave = Math.floor(t / 260) % 2;
      px(ctx, v.palette.c ?? '#4f8cc9', x + 26, y + 7, 2, 6);
      px(ctx, SCENE.outline, x + 25 + wave, y + 3, 4, 5);
      px(ctx, v.palette.s ?? '#f1c27d', x + 26 + wave, y + 4, 2, 3);
    }
  }

  ctx.drawImage(rasterize(DESK, BASE_PALETTE, 'desk'), x + 3, y + 17);

  if (agent && present) {
    const skin = characterVariant(agent.id).palette.s ?? '#f1c27d';
    const typing = agent.status === 'working';
    const f = Math.floor(t / 110) % 2;
    px(ctx, SCENE.outline, x + 9, y + 16 + (typing ? f : 1), 4, 3);
    px(ctx, skin, x + 10, y + 16 + (typing ? f : 1), 2, 2);
    if (agent.status !== 'waiting_you') {
      px(ctx, SCENE.outline, x + 27, y + 16 + (typing ? 1 - f : 1), 4, 3);
      px(ctx, skin, x + 28, y + 16 + (typing ? 1 - f : 1), 2, 2);
    }
  }

  if (agent?.status === 'working') {
    const pulse = 0.28 + 0.18 * Math.sin(t / 260);
    ctx.fillStyle = `rgba(126,224,255,${pulse.toFixed(3)})`;
    ctx.fillRect(x + 11, y + 10, 18, 11);
  }
  ctx.drawImage(rasterize(MONITOR, BASE_PALETTE, 'monitor'), x + 13, y + 12);
  if (present) {
    px(ctx, agent?.status === 'error' ? SCENE.danger : '#6cd46c', x + 24, y + 17, 1, 1);
  } else {
    px(ctx, 'rgba(22,19,31,0.45)', x + 14, y + 13, 12, 6);
  }

  // Name plate.
  const plateX = desk.x + 2;
  const plateY = y + 31;
  const plateW = desk.w - 4;
  const blinkWarn = agent?.status === 'waiting_you' && Math.floor(t / 400) % 2 === 0;
  px(ctx, blinkWarn ? SCENE.warn : SCENE.outline, plateX, plateY, plateW, 10);
  px(ctx, present ? SCENE.plate : SCENE.plateMuted, plateX + 1, plateY + 1, plateW - 2, 8);
  if (agent) {
    px(ctx, STATUS_COLOURS[agent.status], plateX + 3, plateY + 3, 3, 4);
    text(ctx, agent.name, plateX + 8, plateY + 5.5, {
      size: 5.5,
      colour: present ? style.accent : SCENE.textMuted,
      maxWidth: plateW - 10,
    });
  } else if (desk.future) {
    text(ctx, futureLabel, plateX + plateW / 2, plateY + 5.5, {
      size: 5,
      colour: SCENE.textMuted,
      align: 'center',
      maxWidth: plateW - 4,
    });
  }
}

/** Status effects that must sit above every desk (bubbles, smoke, sparkles). */
export function drawDeskOverlay(ctx: Ctx, desk: Desk, agent: SceneAgent, t: number): void {
  const { x, y } = figureOrigin(desk);
  const seed = hash32(agent.id) % 1000;
  switch (agent.status) {
    case 'waiting_you': {
      const up = Math.floor(t / 300) % 2;
      bubble(ctx, x + 27, y - 4 - up, SCENE.warn);
      exclamation(ctx, x + 32, y - 2 - up, SCENE.outline);
      break;
    }
    case 'error': {
      bubble(ctx, x + 27, y - 4, SCENE.danger);
      exclamation(ctx, x + 32, y - 2, SCENE.white);
      for (let i = 0; i < 3; i++) {
        const phase = ((t + seed + i * 700) % 2100) / 2100;
        const size = phase < 0.5 ? 2 : 3;
        ctx.fillStyle = `rgba(120,116,132,${(0.7 * (1 - phase)).toFixed(3)})`;
        ctx.fillRect(
          Math.round(x + 17 + i * 3 + phase * 3),
          Math.round(y + 11 - phase * 12),
          size,
          size,
        );
      }
      break;
    }
    case 'waiting_external': {
      bubble(ctx, x + 27, y - 4, SCENE.white);
      hourglass(ctx, x + 30, y - 3, Math.floor(t / 1000) % 2 === 0);
      break;
    }
    case 'idle': {
      const phase = ((t + seed * 3) % 2600) / 2600;
      if (phase < 0.75) {
        ctx.globalAlpha = 1 - phase / 0.75;
        text(ctx, 'z', x + 28 + phase * 3, y + 3 - phase * 7, { size: 6, colour: '#efe9ff' });
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'working': {
      for (let i = 0; i < 3; i++) {
        const phase = ((t + seed + i * 420) % 1260) / 1260;
        ctx.fillStyle = `rgba(126,224,255,${(1 - phase).toFixed(3)})`;
        ctx.fillRect(x + 15 + ((seed + i * 5) % 11), Math.round(y + 11 - phase * 9), 1, 1);
      }
      break;
    }
    case 'offline':
      break;
  }
}

function bubble(ctx: Ctx, x: number, y: number, fill: string): void {
  box(ctx, fill, x, y, 11, 10);
  px(ctx, SCENE.outline, x + 1, y + 10, 3, 1);
  px(ctx, SCENE.outline, x, y + 11, 2, 1);
  px(ctx, fill, x + 2, y + 9, 1, 1);
}

function exclamation(ctx: Ctx, x: number, y: number, colour: string): void {
  px(ctx, colour, x, y, 2, 4);
  px(ctx, colour, x, y + 5, 2, 1);
}

function hourglass(ctx: Ctx, x: number, y: number, topFull: boolean): void {
  px(ctx, SCENE.outline, x, y, 5, 1);
  px(ctx, SCENE.outline, x, y + 7, 5, 1);
  px(ctx, SCENE.outline, x, y + 1, 1, 6);
  px(ctx, SCENE.outline, x + 4, y + 1, 1, 6);
  const sand = '#e0a43a';
  if (topFull) {
    px(ctx, sand, x + 1, y + 1, 3, 2);
    px(ctx, sand, x + 2, y + 3, 1, 1);
  } else {
    px(ctx, sand, x + 2, y + 4, 1, 1);
    px(ctx, sand, x + 1, y + 5, 3, 2);
  }
}

// ---------------------------------------------------------------- selection

export function drawSelection(
  ctx: Ctx,
  rect: Rect,
  colour: string,
  t: number,
  strong: boolean,
): void {
  const o = strong ? Math.floor(t / 350) % 2 : 0;
  const x0 = rect.x - 1 - o;
  const y0 = rect.y - 1 - o;
  const x1 = rect.x + rect.w + o;
  const y1 = rect.y + rect.h - 2 + o;
  const len = 5;
  const th = strong ? 2 : 1;
  ctx.fillStyle = colour;
  for (const [cx, cy, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    ctx.fillRect(dx > 0 ? cx : cx - len + 1, dy > 0 ? cy : cy - th + 1, len, th);
    ctx.fillRect(dx > 0 ? cx : cx - th + 1, dy > 0 ? cy : cy - len + 1, th, len);
  }
}

/** Speech bubble with the selected agent's activity, kept inside the office bounds. */
export function drawActivityBubble(
  ctx: Ctx,
  layout: OfficeLayout,
  desk: Desk,
  value: string,
): void {
  ctx.font = `600 6px ${FONT}`;
  const maxW = 120;
  const lines = wrap(ctx, value, maxW - 8).slice(0, 3);
  const w = Math.min(maxW, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 9);
  const h = lines.length * 8 + 5;
  const anchorX = desk.x + Math.floor(desk.w / 2);
  const bx = Math.max(2, Math.min(layout.width - w - 2, Math.round(anchorX - w / 2)));
  // Try above and below the desk; keep the spot that hides the fewest neighbours and signs.
  const above = { x: bx, y: desk.y - h - 4, w, h };
  const belowRect = { x: bx, y: desk.y + desk.h - 1, w, h };
  const below = bubbleCost(layout, belowRect, desk) < bubbleCost(layout, above, desk);
  const by = below ? belowRect.y : above.y;
  box(ctx, SCENE.white, bx, by, w, h);
  const tailX = Math.max(bx + 3, Math.min(bx + w - 6, anchorX - 1));
  if (below) {
    px(ctx, SCENE.outline, tailX, by - 2, 3, 2);
    px(ctx, SCENE.white, tailX + 1, by - 1, 1, 2);
  } else {
    px(ctx, SCENE.outline, tailX, by + h, 3, 2);
    px(ctx, SCENE.white, tailX + 1, by + h - 1, 1, 2);
  }
  lines.forEach((line, i) =>
    text(ctx, line, bx + 4.5, by + 6.5 + i * 8, { size: 6, weight: 600, colour: SCENE.outline }),
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function bubbleCost(layout: OfficeLayout, r: Rect, own: Desk): number {
  if (r.y < 1 || r.y + r.h > layout.height - 1) return 1000;
  let cost = 0;
  for (const room of layout.rooms) {
    if (overlaps(r, signRect(room))) cost += 2;
    for (const d of room.desks) if (d !== own && d.agentId && overlaps(r, d)) cost += 3;
  }
  return cost;
}

function wrap(ctx: Ctx, value: string, maxWidth: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => ellipsize(ctx, l, maxWidth));
}

// ---------------------------------------------------------------- live wall screens

export function drawRoomSign(ctx: Ctx, room: RoomLayout, label: string): void {
  const s = signRect(room);
  text(ctx, label.toUpperCase(), s.x + 4, s.y + s.h / 2 - 0.5, {
    size: 5.5,
    colour: roomStyle(room.id).accent,
    maxWidth: s.w - 8,
  });
}

export function drawQuota(
  ctx: Ctx,
  item: WallItem,
  quota: Quota | null,
  t: number,
  emptyLabel: string,
): void {
  const ix = item.x + 2;
  const iw = item.w - 4;
  if (!quota || quota.windows.length === 0) {
    text(ctx, emptyLabel, item.x + item.w / 2, item.y + item.h / 2, {
      size: 5,
      colour: SCENE.textMuted,
      align: 'center',
      maxWidth: iw,
    });
    return;
  }
  quota.windows.slice(0, 2).forEach((w, i) => {
    const rowY = item.y + 3 + i * 8;
    text(ctx, w.name, ix + 1, rowY + 2.5, { size: 4.5, colour: '#c9c3d6', maxWidth: 12 });
    const barX = ix + 14;
    const barW = iw - 16;
    px(ctx, '#2a2f45', barX, rowY, barW, 5);
    const fill = Math.round((barW * Math.min(100, w.usedPercent)) / 100);
    const colour = w.usedPercent < 60 ? '#6cd46c' : w.usedPercent < 85 ? '#ffd24a' : '#ff5a5f';
    px(ctx, colour, barX, rowY, fill, 5);
    px(ctx, 'rgba(255,255,255,0.25)', barX, rowY, fill, 1);
  });
  if (Math.floor(t / 600) % 2 === 0)
    px(ctx, '#6cd46c', item.x + item.w - 4, item.y + item.h - 4, 1, 1);
}

export function drawChart(ctx: Ctx, item: WallItem, t: number): void {
  const step = Math.floor(t / 1500);
  const count = 9;
  const innerTop = item.y + 3;
  const innerH = item.h - 6;
  for (let gx = item.x + 4; gx < item.x + item.w - 2; gx += 6)
    px(ctx, '#232842', gx, innerTop, 1, innerH);
  let price = 0.5;
  for (let i = 0; i < count; i++) {
    const r = (hash32(`c${step + i}`) % 1000) / 1000;
    const open = price;
    price = Math.max(0.12, Math.min(0.88, price + (r - 0.48) * 0.35));
    const close = price;
    const up = close >= open;
    const top = innerTop + Math.round((1 - Math.max(open, close)) * innerH);
    const bottom = innerTop + Math.round((1 - Math.min(open, close)) * innerH);
    const cx = item.x + 4 + i * 6;
    px(ctx, up ? '#4fd17a' : '#ff6b6b', cx + 1, top - 1, 1, bottom - top + 3);
    px(ctx, up ? '#4fd17a' : '#ff6b6b', cx, top, 3, Math.max(1, bottom - top));
  }
}

export function drawClock(ctx: Ctx, item: WallItem, now: Date): void {
  const cx = item.x + 5;
  const cy = item.y + 5;
  const hand = (angle: number, len: number, colour: string) => {
    for (let i = 1; i <= len; i++) {
      px(
        ctx,
        colour,
        Math.round(cx + Math.sin(angle) * i - 0.5),
        Math.round(cy - Math.cos(angle) * i - 0.5),
        1,
        1,
      );
    }
  };
  const minutes = now.getMinutes() + now.getSeconds() / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  hand((hours / 12) * Math.PI * 2, 2, SCENE.outline);
  hand((minutes / 60) * Math.PI * 2, 3, '#d0605e');
  px(ctx, SCENE.outline, cx - 1, cy - 1, 1, 1);
}

export function drawRackLeds(ctx: Ctx, room: RoomLayout, t: number): void {
  for (const d of room.decor) {
    if (d.kind !== 'rack') continue;
    rackLeds(d).forEach((led, i) => {
      const period = 180 + ((i * 97 + d.x) % 420);
      const on = (Math.floor(t / period) + i) % 3 !== 0;
      const colour = i % 5 === 3 ? '#ffb347' : '#6cd46c';
      px(ctx, on ? colour : '#1b3a24', led.x, led.y, 1, 1);
    });
  }
}
