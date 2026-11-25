/**
 * Everything that never moves, rendered once into an offscreen canvas at 1 art pixel per
 * pixel: floors, walls, wall and floor decor, desks and chairs. Sprites are drawn in order of
 * their bottom edge, so lower things overlap higher ones (top-down 3/4 view).
 */
import type { SceneArt } from './art';
import { FURNITURE } from './furniture';
import { TILE, type OfficeLayout } from './layout';
import { roomTheme } from './rooms';
import { buildTileMap, cellAt, FLOOR, WALL, wallMask } from './tilemap';

/** Empty space around and between rooms. */
export const VOID_COLOUR = '#14121c';

interface Item {
  z: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

export function renderBackground(layout: OfficeLayout, art: SceneArt): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = VOID_COLOUR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const map = buildTileMap(layout);
  for (let r = 0; r < map.h; r++) {
    for (let c = 0; c < map.w; c++) {
      const cell = cellAt(map, c, r);
      const room = layout.rooms[cell - FLOOR];
      if (cell < FLOOR || !room) continue;
      const { tile, colour } = roomTheme(room.id).floor;
      ctx.drawImage(art.floor(tile, colour), c * TILE, r * TILE);
    }
  }

  const items: Item[] = [];
  const sprite = (
    image: CanvasImageSource & { width: number; height: number },
    x: number,
    y: number,
    z: number,
    mirror = false,
  ) =>
    items.push({
      z,
      draw: (g) => {
        if (!mirror) {
          g.drawImage(image, x, y);
          return;
        }
        g.save();
        g.translate(x + image.width, y);
        g.scale(-1, 1);
        g.drawImage(image, 0, 0);
        g.restore();
      },
    });

  // Walls: each piece is 16x32 and covers the tile above its own.
  for (let r = 0; r < map.h; r++) {
    for (let c = 0; c < map.w; c++) {
      if (cellAt(map, c, r) !== WALL) continue;
      const mask = wallMask(map, c, r);
      const sx = (mask % 4) * TILE;
      const sy = Math.floor(mask / 4) * 2 * TILE;
      items.push({
        z: (r + 1) * TILE,
        draw: (g) =>
          g.drawImage(art.wall, sx, sy, TILE, 2 * TILE, c * TILE, (r - 1) * TILE, TILE, 2 * TILE),
      });
    }
  }

  for (const room of layout.rooms) {
    for (const decor of room.decor) {
      decor.parts.forEach((part, i) => {
        const image = art.decor[part.id];
        if (!image) return;
        const x = (decor.tx + part.dx) * TILE;
        const y = (decor.ty + part.dy) * TILE;
        // Wall decor hangs in front of its wall row; parts stack in the order they are listed.
        const base = decor.layer === 'wall' ? (decor.ty + 2) * TILE + 0.5 : y + image.height;
        sprite(image, x, y, base + i * 0.01 + (i > 0 ? decor.th * TILE : 0), part.mirror);
      });
    }
    for (const desk of room.desks) {
      const deskY = desk.y;
      sprite(art.desk, desk.x + TILE, deskY, deskY + FURNITURE.DESK_FRONT.h * TILE);
      sprite(art.chair, desk.x + 2 * TILE, deskY + 2 * TILE, deskY + 3 * TILE);
    }
  }

  items.sort((a, b) => a.z - b.z).forEach((item) => item.draw(ctx));
  return canvas;
}
