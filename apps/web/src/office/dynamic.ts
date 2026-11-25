/**
 * Per-frame drawing: computers, people, status badges, signs, plates and selection.
 * All coordinates are art pixels; the caller applies the integer device scale.
 */
import type { AgentStatus } from '@ai-office/protocol';
import { agentView } from './agentView';
import type { SceneArt } from './art';
import {
  SIGN_TILES,
  TILE,
  type Desk,
  type OfficeLayout,
  type Rect,
  type RoomLayout,
} from './layout';
import { roomTheme } from './rooms';

type Ctx = CanvasRenderingContext2D;

export interface SceneAgent {
  id: string;
  name: string;
  status: AgentStatus;
  activity: string | null;
}

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** Interface colours used inside the scene (tokens from styles.css). */
export const INK = {
  outline: '#1d1a29',
  plate: '#14121c',
  text: '#ece6d8',
  muted: '#9b93ab',
  bubble: '#f4f1ea',
  /** --accent: focus and selection. */
  accent: '#f2b84b',
} as const;

export const STATUS_COLOURS: Readonly<Record<AgentStatus, string>> = {
  working: '#6cd46c',
  waiting_you: '#ffd24a',
  waiting_external: '#79bcff',
  error: '#ff5a5f',
  idle: '#b9b2c6',
  offline: '#5d566b',
};

export function px(ctx: Ctx, colour: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
}

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
  const { size = 6, colour = INK.text, weight = 700, align = 'left', maxWidth } = opts;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.fillText(maxWidth ? ellipsize(ctx, value, maxWidth) : value, x, y);
}

const widths = new Map<string, number>();

/** `measureText` width, cached per font and text (labels repeat every redraw). */
export function textWidth(ctx: Ctx, value: string): number {
  const key = `${ctx.font}
${value}`;
  let w = widths.get(key);
  if (w === undefined) {
    if (widths.size > 4000) widths.clear();
    w = ctx.measureText(value).width;
    widths.set(key, w);
  }
  return w;
}

export function ellipsize(ctx: Ctx, value: string, maxWidth: number): string {
  if (textWidth(ctx, value) <= maxWidth) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(ctx, `${value.slice(0, mid)}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${value.slice(0, lo)}…`;
}

// ---------------------------------------------------------------- desks & people

/** Where the person (a 16x32 frame) is drawn in a desk slot: on the chair, under the computer. */
export function personOrigin(desk: Desk): { x: number; y: number } {
  return { x: desk.x + 2 * TILE, y: desk.y + 2 * TILE - 18 };
}

/** Computer and person of one desk (the desk and chair are in the background). */
export function drawDesk(
  ctx: Ctx,
  desk: Desk,
  agent: SceneAgent,
  look: number,
  art: SceneArt,
  t: number,
  still: boolean,
): void {
  const view = agentView(agent.status, t, still);
  ctx.drawImage(art.monitors[view.monitor], desk.x + 2 * TILE, desk.y);
  const person = art.characters[look % art.characters.length];
  if (!person || view.pose === 'absent') return;
  const frame =
    view.pose === 'hand-up'
      ? person.raised[0]
      : view.pose === 'hand-up-sway'
        ? person.raised[1]
        : person.seated;
  const { x, y } = personOrigin(desk);
  ctx.drawImage(frame, x, y);
}

/** Status badge beside the head; drawn after every desk so neighbours never hide it. */
export function drawBadge(
  ctx: Ctx,
  desk: Desk,
  agent: SceneAgent,
  look: number,
  art: SceneArt,
  t: number,
  still: boolean,
): void {
  const view = agentView(agent.status, t, still);
  const person = art.characters[look % art.characters.length];
  if (!view.badge || !person) return;
  const { x, y } = personOrigin(desk);
  const headTop = y + person.headTop;
  if (view.badge === 'dot') {
    ctx.drawImage(art.dot, x + 15, headTop + 1);
    return;
  }
  const bubble = art.bubbles[view.badge];
  // Right of the head, clear of the screen; left of it when the right hand is up.
  const bx = view.badge === 'bang' ? x - 10 : x + 15;
  ctx.drawImage(bubble, bx, headTop - 6 - view.lift);
}

/**
 * Labels are sized in CSS pixels, not art pixels, so text stays 11 px whatever the scale:
 * `u` is the size of one CSS pixel in art pixels (devicePixelRatio / scale).
 */
export const LABEL_FONT_PX = 11;

/** Name plate under the desk: status square + name (muted when offline). */
export function drawPlate(
  ctx: Ctx,
  desk: Desk,
  agent: SceneAgent,
  t: number,
  still: boolean,
  u: number,
): void {
  const present = agent.status !== 'offline';
  const size = LABEL_FONT_PX * u;
  ctx.font = `700 ${size}px ${FONT}`;
  const pad = 5 * u;
  const dot = 6 * u;
  const border = 2 * u;
  const maxW = desk.w - 4;
  const chrome = border * 2 + pad * 2 + dot + 4 * u;
  const textW = Math.min(textWidth(ctx, agent.name), maxW - chrome);
  const w = Math.min(maxW, Math.ceil(textW + chrome));
  const h = 18 * u;
  const x = desk.x + (desk.w - w) / 2;
  const y = desk.y + 3 * TILE + 2;
  const blinkWarn = agent.status === 'waiting_you' && !still && Math.floor(t / 400) % 2 === 0;
  px(ctx, blinkWarn ? STATUS_COLOURS.waiting_you : INK.outline, x, y, w, h);
  px(ctx, INK.plate, x + border, y + border, w - 2 * border, h - 2 * border);
  px(ctx, STATUS_COLOURS[agent.status], x + border + pad, y + (h - dot) / 2, dot, dot);
  text(ctx, agent.name, x + border + pad + dot + 4 * u, y + h / 2, {
    size,
    colour: present ? INK.text : INK.muted,
    maxWidth: textW,
  });
}

// ---------------------------------------------------------------- room signs

/**
 * The sign sits on the left of the room's wall band, within the SIGN_TILES that wall decor
 * leaves free (layout.ts), so it never covers a painting or a clock.
 */
export function signRect(room: RoomLayout, u: number): Rect {
  const h = 18 * u;
  return { x: room.x + 3, y: room.y - TILE / 2 - h / 2, w: SIGN_TILES * TILE - 5, h };
}

export function drawRoomSign(ctx: Ctx, room: RoomLayout, label: string, u: number): void {
  const max = signRect(room, u);
  const size = LABEL_FONT_PX * u;
  ctx.font = `700 ${size}px ${FONT}`;
  const value = label.toUpperCase();
  const pad = 6 * u;
  const border = 2 * u;
  const w = Math.min(max.w, Math.ceil(textWidth(ctx, value) + 2 * (pad + border)));
  const accent = roomTheme(room.id).accent;
  px(ctx, INK.outline, max.x, max.y, w, max.h);
  px(ctx, INK.plate, max.x + border, max.y + border, w - 2 * border, max.h - 2 * border);
  px(ctx, accent, max.x + border, max.y + max.h - 2 * border, w - 2 * border, border);
  text(ctx, value, max.x + border + pad, max.y + max.h / 2 - u / 2, {
    size,
    colour: accent,
    maxWidth: w - 2 * (pad + border),
  });
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
  const x0 = rect.x + 1 - o;
  const y0 = rect.y - 1 - o;
  const x1 = rect.x + rect.w - 2 + o;
  const y1 = rect.y + rect.h - 1 + o;
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
  u: number,
): void {
  const size = 12 * u;
  const line = 16 * u;
  const pad = 8 * u;
  ctx.font = `600 ${size}px ${FONT}`;
  const maxW = Math.min(260 * u, layout.width - 4);
  const lines = wrap(ctx, value, maxW - 2 * pad).slice(0, 3);
  const w = Math.min(maxW, Math.ceil(Math.max(...lines.map((l) => textWidth(ctx, l))) + 2 * pad));
  const h = lines.length * line + pad;
  const anchorX = desk.x + Math.floor(desk.w / 2);
  const bx = Math.max(2, Math.min(layout.width - w - 2, Math.round(anchorX - w / 2)));
  // Try above and below the desk; keep the spot that hides the fewest neighbours and signs.
  const above = { x: bx, y: desk.y - h - 2, w, h };
  const belowRect = { x: bx, y: desk.y + desk.h + 1, w, h };
  const below = bubbleCost(layout, belowRect, desk, u) < bubbleCost(layout, above, desk, u);
  const by = below ? belowRect.y : above.y;
  px(ctx, INK.outline, bx - 1, by - 1, w + 2, h + 2);
  px(ctx, INK.bubble, bx, by, w, h);
  const tailX = Math.max(bx + 3, Math.min(bx + w - 6, anchorX - 1));
  if (below) {
    px(ctx, INK.outline, tailX, by - 3, 3, 2);
    px(ctx, INK.bubble, tailX + 1, by - 2, 1, 2);
  } else {
    px(ctx, INK.outline, tailX, by + h + 1, 3, 2);
    px(ctx, INK.bubble, tailX + 1, by + h, 1, 2);
  }
  lines.forEach((text_, i) =>
    text(ctx, text_, bx + pad, by + pad / 2 + line / 2 + i * line, {
      size,
      weight: 600,
      colour: INK.outline,
    }),
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function bubbleCost(layout: OfficeLayout, r: Rect, own: Desk, u: number): number {
  if (r.y < 1 || r.y + r.h > layout.height - 1) return 1000;
  let cost = 0;
  for (const room of layout.rooms) {
    if (overlaps(r, signRect(room, u))) cost += 2;
    for (const d of room.desks) if (d !== own && overlaps(r, d)) cost += 3;
  }
  return cost;
}

function wrap(ctx: Ctx, value: string, maxWidth: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(ctx, candidate) <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => ellipsize(ctx, l, maxWidth));
}
