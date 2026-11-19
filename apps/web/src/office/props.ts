/**
 * Procedural pixel furniture. Everything is drawn with integer `fillRect`s in logical pixels,
 * so it stays crisp under integer scaling. Static items only; animated parts live in dynamic.ts.
 */
import { SCENE } from './roomStyles';
import { shade } from './sprites';
import type { Decor, WallItem } from './layout';

type Ctx = CanvasRenderingContext2D;

export function px(ctx: Ctx, colour: string, x: number, y: number, w = 1, h = 1): void {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
}

/** Filled rectangle with a 1px outline. */
export function box(
  ctx: Ctx,
  fill: string,
  x: number,
  y: number,
  w: number,
  h: number,
  line: string = SCENE.outline,
): void {
  px(ctx, line, x, y, w, h);
  px(ctx, fill, x + 1, y + 1, w - 2, h - 2);
}

const BOOKS = ['#d0605e', '#4f8cc9', '#e0a43a', '#5fae5a', '#8f6bc9', '#e8e0cf', '#3fb6a8'];

function bookshelf(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const wood = '#7a5235';
  box(ctx, wood, x, y, w, h);
  px(ctx, shade(wood, 0.75), x + 1, y + 1, w - 2, 1);
  const shelfH = Math.floor((h - 2) / 3);
  for (let s = 0; s < 3; s++) {
    const sy = y + 1 + s * shelfH;
    px(ctx, '#3d2a1d', x + 2, sy + 1, w - 4, shelfH - 2);
    let bx = x + 2;
    let i = s * 3;
    while (bx < x + w - 3) {
      const bw = 2 + ((i * 7) % 2);
      const bh = shelfH - 3 - ((i * 5) % 3);
      const colour = BOOKS[i % BOOKS.length] as string;
      px(ctx, colour, bx, sy + shelfH - 1 - bh, bw, bh);
      px(ctx, shade(colour, 1.2), bx, sy + shelfH - 1 - bh, 1, bh);
      bx += bw + (i % 4 === 3 ? 1 : 0);
      i++;
    }
    px(ctx, shade(wood, 1.15), x + 1, sy + shelfH - 1, w - 2, 1);
  }
}

function rack(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  box(ctx, '#252a36', x, y, w, h);
  for (let u = 0; u < 6; u++) {
    const uy = y + 2 + u * 5;
    if (uy + 4 > y + h - 1) break;
    px(ctx, '#3a4152', x + 2, uy, w - 4, 4);
    px(ctx, '#4b5367', x + 2, uy, w - 4, 1);
    px(ctx, '#1b1f29', x + 3, uy + 2, w - 9, 1);
  }
  px(ctx, '#1b1f29', x + 1, y + h - 2, w - 2, 1);
}

/** LED anchor points for a rack, used by the dynamic pass to blink them. */
export function rackLeds(d: Decor): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let u = 0; u < 6; u++) {
    const uy = d.y + 2 + u * 5;
    if (uy + 4 > d.y + d.h - 1) break;
    out.push({ x: d.x + d.w - 5, y: uy + 1 }, { x: d.x + d.w - 4, y: uy + 2 });
  }
  return out;
}

function coffee(ctx: Ctx, x: number, y: number): void {
  box(ctx, '#3b3f58', x, y, 12, 18);
  px(ctx, '#565b78', x + 1, y + 1, 10, 3);
  px(ctx, '#9de38a', x + 7, y + 2, 3, 1);
  px(ctx, '#1d1f2c', x + 3, y + 6, 6, 6);
  px(ctx, '#8a93a6', x + 5, y + 6, 2, 2);
  px(ctx, SCENE.white, x + 4, y + 9, 4, 3);
  px(ctx, '#c9c1b2', x + 4, y + 11, 4, 1);
  px(ctx, '#2a2d40', x + 1, y + 14, 10, 3);
}

function cooler(ctx: Ctx, x: number, y: number): void {
  box(ctx, '#8fd3ff', x + 2, y, 6, 8, '#3d6f8f');
  px(ctx, '#c9ecff', x + 3, y + 1, 1, 6);
  box(ctx, '#e8e8f0', x, y + 8, 10, 12);
  px(ctx, '#d0605e', x + 2, y + 11, 2, 2);
  px(ctx, '#4f8cc9', x + 6, y + 11, 2, 2);
  px(ctx, '#c8c8d4', x + 1, y + 17, 8, 2);
}

function sofa(ctx: Ctx, x: number, y: number, w: number): void {
  const c = '#5a6fb0';
  box(ctx, c, x, y, w, 9);
  px(ctx, shade(c, 1.2), x + 1, y + 1, w - 2, 2);
  box(ctx, shade(c, 0.85), x, y + 7, w, 9);
  px(ctx, shade(c, 1.1), x + 4, y + 8, w / 2 - 5, 4);
  px(ctx, shade(c, 1.1), x + w / 2 + 1, y + 8, w / 2 - 5, 4);
  box(ctx, shade(c, 0.7), x - 3, y + 4, 5, 12);
  box(ctx, shade(c, 0.7), x + w - 2, y + 4, 5, 12);
}

function table(ctx: Ctx, x: number, y: number, w: number): void {
  box(ctx, '#a8744f', x, y, w, 6);
  px(ctx, '#c08a62', x + 1, y + 1, w - 2, 2);
  px(ctx, SCENE.outline, x + 2, y + 6, 2, 4);
  px(ctx, SCENE.outline, x + w - 4, y + 6, 2, 4);
  px(ctx, SCENE.white, x + 5, y + 1, 3, 3);
  px(ctx, '#6b3f2a', x + 6, y + 1, 1, 1);
  px(ctx, '#d0605e', x + 14, y + 2, 6, 2);
}

function rug(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  px(ctx, '#7d4560', x, y, w, h);
  px(ctx, '#b0637f', x + 2, y + 2, w - 4, h - 4);
  px(ctx, '#c9859c', x + 4, y + 4, w - 8, h - 8);
  for (let i = 6; i < w - 6; i += 6) {
    px(ctx, '#b0637f', x + i, y + 6, 2, 2);
    px(ctx, '#b0637f', x + i, y + h - 8, 2, 2);
  }
  for (let i = 0; i < w; i += 3) {
    px(ctx, '#e8d9c4', x + i, y - 1, 1, 1);
    px(ctx, '#e8d9c4', x + i, y + h, 1, 1);
  }
}

function lamp(ctx: Ctx, x: number, y: number): void {
  box(ctx, '#f2e2b5', x, y, 8, 6, '#8f7a4a');
  px(ctx, '#fff6d8', x + 1, y + 4, 6, 1);
  px(ctx, '#4a3d33', x + 3, y + 6, 2, 13);
  px(ctx, SCENE.outline, x + 1, y + 19, 6, 3);
}

function windowItem(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  box(ctx, '#e9dcc4', x, y, w, h, '#4a3426');
  px(ctx, '#8fd3ff', x + 2, y + 2, w - 4, h - 5);
  px(ctx, '#b6e4ff', x + 2, y + 2, w - 4, 3);
  px(ctx, '#c9ecff', x + 4, y + 6, 1, 3);
  px(ctx, '#c9ecff', x + 5, y + 5, 1, 1);
  px(ctx, '#e9dcc4', x + Math.floor(w / 2), y + 2, 1, h - 5);
  px(ctx, '#e9dcc4', x + 2, y + Math.floor(h / 2) - 1, w - 4, 1);
  // curtains
  px(ctx, '#f0e6f6', x - 1, y - 1, 3, h - 2);
  px(ctx, '#f0e6f6', x + w - 2, y - 1, 3, h - 2);
  px(ctx, '#cfc2db', x + 1, y - 1, 1, h - 2);
  px(ctx, '#cfc2db', x + w - 2, y - 1, 1, h - 2);
  // sill
  px(ctx, '#4a3426', x - 1, y + h - 1, w + 2, 2);
}

function poster(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  box(ctx, '#ffe9b8', x, y, w, h, '#4a3426');
  px(ctx, '#ff9f6b', x + w - 7, y + 3, 4, 4);
  px(ctx, '#5fae5a', x + 2, y + h - 6, w - 4, 4);
  px(ctx, '#3f8a45', x + 4, y + h - 9, 4, 3);
  px(ctx, '#3f8a45', x + 8, y + h - 11, 4, 5);
}

function vent(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  box(ctx, '#8a93a6', x, y, w, h);
  for (let i = 2; i < h - 1; i += 2) px(ctx, '#4b5367', x + 2, y + i, w - 4, 1);
}

function whiteboard(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  box(ctx, '#f7f7fb', x, y, w, h, '#8a93a6');
  box(ctx, '#f7f7fb', x + 4, y + 4, 12, 6, '#4f8cc9');
  box(ctx, '#f7f7fb', x + 26, y + 4, 12, 6, '#4f8cc9');
  px(ctx, '#4f8cc9', x + 16, y + 7, 10, 1);
  px(ctx, '#d0605e', x + 8, y + 13, 24, 1);
  px(ctx, '#d0605e', x + 40, y + 5, 6, 1);
  px(ctx, '#d0605e', x + 40, y + 8, 4, 1);
  px(ctx, '#5fae5a', x + 40, y + 12, 7, 1);
  px(ctx, '#8a93a6', x + 2, y + h - 1, w - 4, 2);
}

function screenFrame(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  box(ctx, '#151826', x, y, w, h, '#4b5367');
  px(ctx, '#4b5367', x + Math.floor(w / 2) - 3, y + h, 6, 2);
}

function clockFace(ctx: Ctx, x: number, y: number): void {
  px(ctx, SCENE.outline, x + 2, y, 6, 10);
  px(ctx, SCENE.outline, x, y + 2, 10, 6);
  px(ctx, SCENE.outline, x + 1, y + 1, 8, 8);
  px(ctx, SCENE.white, x + 2, y + 1, 6, 8);
  px(ctx, SCENE.white, x + 1, y + 2, 8, 6);
}

export function drawDecor(ctx: Ctx, d: Decor, plant: CanvasImageSource): void {
  switch (d.kind) {
    case 'bookshelf':
      return bookshelf(ctx, d.x, d.y, d.w, d.h);
    case 'rack':
      return rack(ctx, d.x, d.y, d.w, d.h);
    case 'coffee':
      return coffee(ctx, d.x, d.y);
    case 'cooler':
      return cooler(ctx, d.x, d.y);
    case 'sofa':
      return sofa(ctx, d.x, d.y, d.w);
    case 'table':
      return table(ctx, d.x, d.y, d.w);
    case 'lamp':
      return lamp(ctx, d.x, d.y);
    case 'rug':
      return rug(ctx, d.x, d.y, d.w, d.h);
    case 'plant':
      ctx.drawImage(plant, d.x, d.y);
      return;
  }
}

export function drawWallItem(ctx: Ctx, item: WallItem): void {
  switch (item.kind) {
    case 'window':
      return windowItem(ctx, item.x, item.y, item.w, item.h);
    case 'poster':
      return poster(ctx, item.x, item.y, item.w, item.h);
    case 'vent':
      return vent(ctx, item.x, item.y, item.w, item.h);
    case 'whiteboard':
      return whiteboard(ctx, item.x, item.y, item.w, item.h);
    case 'chart':
    case 'quota':
      return screenFrame(ctx, item.x, item.y, item.w, item.h);
    case 'clock':
      return clockFace(ctx, item.x, item.y);
  }
}
