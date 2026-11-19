import { TRANSPARENT, type Palette, type Sprite } from './sprites';

const cache = new Map<string, HTMLCanvasElement>();

/** Rasterises a palette sprite once (1 art pixel = 1 canvas pixel) and caches it by key. */
export function rasterize(sprite: Sprite, palette: Palette, key: string): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = sprite.w;
  canvas.height = sprite.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as string;
      if (ch === TRANSPARENT) continue;
      const colour = palette[ch];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  cache.set(key, canvas);
  return canvas;
}
