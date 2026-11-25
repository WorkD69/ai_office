/**
 * Pure RGBA pixel operations on plain buffers (no DOM), so the art pipeline is unit-tested.
 * Pixel art here is either fully opaque or fully transparent: alpha below 128 counts as empty.
 */

export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Hue 0-360, saturation 0-100, brightness and contrast -100..100 (Pixel Agents' colour model). */
export interface Hsbc {
  h: number;
  s: number;
  b: number;
  c: number;
}

export const OPAQUE = 128;

export function createPixels(width: number, height: number): Pixels {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function clonePixels(src: Pixels): Pixels {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}

const offset = (p: Pixels, x: number, y: number) => (y * p.width + x) * 4;

export function isOpaqueAt(p: Pixels, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return false;
  return (p.data[offset(p, x, y) + 3] ?? 0) >= OPAQUE;
}

/** `[r, g, b, a]` at a point; transparent black outside the buffer. */
export function getPixel(p: Pixels, x: number, y: number): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return [0, 0, 0, 0];
  const i = offset(p, x, y);
  const d = p.data;
  return [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, d[i + 3] ?? 0];
}

export function setPixel(p: Pixels, x: number, y: number, rgba: readonly number[]): void {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
  p.data.set(rgba.slice(0, 4), offset(p, x, y));
}

export function crop(src: Pixels, x: number, y: number, w: number, h: number): Pixels {
  const out = createPixels(w, h);
  for (let row = 0; row < h; row++) {
    const from = offset(src, x, y + row);
    out.data.set(src.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}

/** Draws `src` over `dst` in place (same size): opaque pixels of `src` replace `dst`. */
export function drawOver(dst: Pixels, src: Pixels): void {
  if (dst.width !== src.width || dst.height !== src.height) {
    throw new Error(`layer size ${src.width}x${src.height} != ${dst.width}x${dst.height}`);
  }
  const s = src.data;
  for (let i = 0; i < s.length; i += 4) {
    if ((s[i + 3] ?? 0) >= OPAQUE) dst.data.set(s.subarray(i, i + 4), i);
  }
}

/** First row with an opaque pixel (the top of a sprite), or -1 for an empty buffer. */
export function topRow(p: Pixels): number {
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) if (isOpaqueAt(p, x, y)) return y;
  }
  return -1;
}

// ---------------------------------------------------------------- colour

/** HSL (h 0-360, s and l 0-1) to RGB 0-255. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return rgb.map((v) => Math.max(0, Math.min(255, Math.round((v + m) * 255)))) as [
    number,
    number,
    number,
  ];
}

/**
 * Photoshop-style colorize: every opaque pixel takes the given hue and saturation, its
 * lightness comes from its own luminance after contrast and brightness. Same formula as
 * Pixel Agents (webview-ui/src/office/colorize.ts, MIT, (c) 2026 Pablo De Lucca), rewritten
 * here so their grey art (floors, walls, clothes, hair) takes our colours.
 */
export function colorize(src: Pixels, { h, s, b, c }: Hsbc): Pixels {
  const out = clonePixels(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if ((d[i + 3] ?? 0) < OPAQUE) continue;
    let l = (0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0)) / 255;
    if (c !== 0) l = 0.5 + (l - 0.5) * ((100 + c) / 100);
    if (b !== 0) l += b / 200;
    const [r, g, bl] = hslToRgb(h, s / 100, Math.max(0, Math.min(1, l)));
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = bl;
  }
  return out;
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [parseInt(m[1] as string, 16), parseInt(m[2] as string, 16), parseInt(m[3] as string, 16)];
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Exact colour replacement (`#rrggbb` -> `#rrggbb`, lowercase keys), e.g. skin tones. */
export function swapColours(src: Pixels, map: Readonly<Record<string, string>>): Pixels {
  const out = clonePixels(src);
  const d = out.data;
  const parsed = new Map(
    Object.entries(map).map(([from, to]) => [from.toLowerCase(), parseHex(to)]),
  );
  for (let i = 0; i < d.length; i += 4) {
    if ((d[i + 3] ?? 0) < OPAQUE) continue;
    const to = parsed.get(toHex(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0));
    if (to) d.set(to, i);
  }
  return out;
}

/** The lit screen of a Pixel Agents monitor (green-dominant pixels) turned red, same lightness. */
export function redScreen(src: Pixels): Pixels {
  const out = clonePixels(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if ((d[i + 3] ?? 0) < OPAQUE) continue;
    const r = d[i] ?? 0;
    const g = d[i + 1] ?? 0;
    const b = d[i + 2] ?? 0;
    if (g > r + 20 && g > b + 10) {
      d[i] = Math.min(255, g + 40);
      d[i + 1] = Math.round(g * 0.25);
      d[i + 2] = Math.round(g * 0.25);
    }
  }
  return out;
}
