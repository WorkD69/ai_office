import { MARGIN, SIGN_H, WALL_H, type OfficeLayout, type RoomLayout } from './layout';
import { drawDecor, drawWallItem, px } from './props';
import { rasterize } from './raster';
import { roomStyle, SCENE } from './roomStyles';
import { BASE_PALETTE, PLANT } from './sprites';

/** Renders everything that never moves into an offscreen canvas at 1 art pixel per pixel. */
export function renderBackground(layout: OfficeLayout): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');

  px(ctx, SCENE.outside, 0, 0, layout.width, layout.height);
  drawHallway(ctx, layout);
  const plant = rasterize(PLANT, BASE_PALETTE, 'plant');
  for (const room of layout.rooms) drawRoom(ctx, room, plant);
  return canvas;
}

function drawHallway(ctx: CanvasRenderingContext2D, layout: OfficeLayout): void {
  const x = MARGIN - 4;
  const y = MARGIN - 4;
  const w = layout.width - 2 * (MARGIN - 4);
  const h = layout.height - 2 * (MARGIN - 4);
  px(ctx, SCENE.building, x - 2, y - 2, w + 4, h + 4);
  px(ctx, SCENE.hallway, x, y, w, h);
  // Staggered wooden planks.
  for (let py = y; py < y + h; py += 4) {
    px(ctx, SCENE.hallwayLine, x, py, w, 1);
    const offset = ((py - y) / 4) % 2 === 0 ? 0 : 12;
    for (let jx = x + offset; jx < x + w; jx += 24) px(ctx, SCENE.hallwayLine, jx, py, 1, 4);
  }
}

function drawRoom(ctx: CanvasRenderingContext2D, room: RoomLayout, plant: CanvasImageSource): void {
  const style = roomStyle(room.id);
  const floorY = room.y + WALL_H;

  // Outer wall line.
  px(ctx, SCENE.outline, room.x - 1, room.y - 1, room.w + 2, room.h + 2);

  // Floor: 8x8 checker carpet with a soft inner border.
  px(ctx, style.floor, room.x, floorY, room.w, room.h - WALL_H);
  for (let ty = floorY; ty < room.y + room.h; ty += 8) {
    for (let tx = room.x; tx < room.x + room.w; tx += 8) {
      if (((tx - room.x) / 8 + (ty - floorY) / 8) % 2 === 1) {
        px(
          ctx,
          style.floorAlt,
          tx,
          ty,
          Math.min(8, room.x + room.w - tx),
          Math.min(8, room.y + room.h - ty),
        );
      }
    }
  }
  px(ctx, style.floorAlt, room.x, floorY, room.w, 2);

  // Wall: plaster, wainscot band, baseboard and a dark top trim.
  px(ctx, style.wall, room.x, room.y, room.w, WALL_H);
  px(ctx, style.wallDark, room.x, room.y, room.w, 2);
  px(ctx, style.wallDark, room.x, room.y + WALL_H - 7, room.w, 4);
  for (let sx = room.x + 3; sx < room.x + room.w; sx += 6) {
    px(ctx, style.wall, sx, room.y + WALL_H - 6, 1, 2);
  }
  px(ctx, SCENE.outline, room.x, room.y + WALL_H - 3, room.w, 1);
  px(ctx, '#d9c3a0', room.x, room.y + WALL_H - 2, room.w, 2);

  for (const item of room.wall) drawWallItem(ctx, item);

  // Sign plate frame (the text is drawn crisp in the dynamic pass).
  const sign = signRect(room);
  px(ctx, SCENE.outline, sign.x, sign.y, sign.w, sign.h);
  px(ctx, SCENE.plate, sign.x + 1, sign.y + 1, sign.w - 2, sign.h - 2);
  px(ctx, style.accent, sign.x + 1, sign.y + sign.h - 2, sign.w - 2, 1);

  for (const d of room.decor) drawDecor(ctx, d, plant);
}

export function signRect(room: RoomLayout): { x: number; y: number; w: number; h: number } {
  const w = 76;
  return { x: room.x + 6, y: room.y + WALL_H + 2, w, h: SIGN_H - 3 };
}
