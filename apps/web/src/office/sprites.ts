/**
 * All pixel art in this project is original and defined here as palette-indexed rows:
 * every character is a palette key, `.` is transparent. Keeping art as data makes it
 * diffable, testable and free of third-party asset licences.
 */
import { pick } from './hash';

export interface Sprite {
  readonly w: number;
  readonly h: number;
  readonly rows: readonly string[];
}

export type Palette = Readonly<Record<string, string>>;

export const TRANSPARENT = '.';

function sprite(rows: string[]): Sprite {
  return { w: rows[0]?.length ?? 0, h: rows.length, rows };
}

const r = (ch: string, n: number): string => ch.repeat(n);

/** Fixed colours shared by all sprites. Variant colours (skin/hair/shirt) are added per agent. */
export const BASE_PALETTE: Palette = {
  o: '#2b2135', // outline
  e: '#2b2135', // eyes
  m: '#b5655b', // mouth
  w: '#f4f1ea', // collar
  p: '#3b3f58', // chair
  P: '#2c2f45', // chair shade
  T: '#d4a574', // desk top
  t: '#b8875a', // desk top shade
  D: '#8f6040', // desk front
  d: '#7c5236', // drawer
  k: '#e2c79a', // handle
  M: '#8a93a6', // monitor back
  L: '#dfe5ef', // logo
  g: '#6cbf5f', // leaf
  G: '#3f8a45', // leaf shade
  q: '#c46f4a', // pot
  Q: '#9e5438', // pot shade
};

// ---------------------------------------------------------------- characters (12x14)

export const CHARACTER_SHORT = sprite([
  '...oooooo...',
  '..ohhhhhho..',
  '.ohhhhhhhho.',
  '.ohHhhhhHho.',
  '.ohssssssho.',
  '.o' + 'se' + r('s', 4) + 'es' + 'o.',
  '.o' + r('s', 8) + 'o.',
  '..ossmmsso..',
  '....oSSo....',
  '..occwwcco..',
  '.o' + r('c', 8) + 'o.',
  'occcccccccco',
  'oCccccccccCo',
  'oCCccccccCCo',
]);

export const CHARACTER_LONG = sprite([
  '...oooooo...',
  '..ohhhhhho..',
  '.ohhhhhhhho.',
  'ohhHhhhhHhho',
  'ohssssssssho',
  'ohsessssesho',
  'ohssssssssho',
  'ohossmmssoho',
  'ohh.oSSo.hho',
  '.ooccwwccoo.',
  '.o' + r('c', 8) + 'o.',
  'occcccccccco',
  'oCccccccccCo',
  'oCCccccccCCo',
]);

export const CHARACTER_TEMPLATES = [CHARACTER_SHORT, CHARACTER_LONG] as const;

const SKIN = ['#f6d3b3', '#f1c27d', '#e0ac69', '#c68642', '#8d5524'] as const;
const HAIR = [
  '#2b1d14',
  '#4a2f1f',
  '#6b3f2a',
  '#a5652f',
  '#d9a441',
  '#e8e0cf',
  '#3a3a46',
  '#b4475a',
] as const;
const SHIRT = [
  '#4f8cc9',
  '#d0605e',
  '#5fae5a',
  '#e0a43a',
  '#8f6bc9',
  '#3fb6a8',
  '#e57fa8',
  '#5b6b8c',
] as const;

export interface CharacterVariant {
  readonly template: Sprite;
  readonly palette: Palette;
  readonly key: string;
}

/** Deterministic look for an agent id: the same agent always looks the same. */
export function characterVariant(id: string): CharacterVariant {
  const skin = pick(SKIN, id, 'skin');
  const hair = pick(HAIR, id, 'hair');
  const shirt = pick(SHIRT, id, 'shirt');
  const template = pick(CHARACTER_TEMPLATES, id, 'style');
  return {
    template,
    key: `char:${template === CHARACTER_SHORT ? 's' : 'l'}:${skin}:${hair}:${shirt}`,
    palette: {
      ...BASE_PALETTE,
      s: skin,
      S: shade(skin, 0.82),
      h: hair,
      H: shade(hair, 1.25),
      c: shirt,
      C: shade(shirt, 0.78),
    },
  };
}

// ---------------------------------------------------------------- furniture

export const CHAIR = sprite([
  '..oooooooooo..',
  '.oppppppppppo.',
  '.oppppppppppo.',
  '.oPPPPPPPPPPo.',
  '.oppppppppppo.',
  '.oPPPPPPPPPPo.',
  '..oooooooooo..',
  '......oo......',
]);

export const DESK = sprite([
  r('o', 34),
  'o' + r('T', 32) + 'o',
  'o' + r('T', 32) + 'o',
  'o' + r('t', 32) + 'o',
  r('o', 34),
  'o' + r('D', 21) + 'o' + r('d', 10) + 'o',
  'o' + r('D', 21) + 'o' + r('d', 10) + 'o',
  'o' + r('D', 21) + 'o' + r('d', 4) + r('k', 2) + r('d', 4) + 'o',
  'o' + r('D', 21) + 'o' + r('d', 10) + 'o',
  'o' + r('D', 21) + 'o' + r('d', 10) + 'o',
  r('o', 34),
  'oo' + r('.', 30) + 'oo',
]);

export const MONITOR = sprite([
  '.' + r('o', 12) + '.',
  'o' + r('M', 12) + 'o',
  'o' + r('M', 12) + 'o',
  'o' + r('M', 5) + r('L', 2) + r('M', 5) + 'o',
  'o' + r('M', 12) + 'o',
  'o' + r('M', 12) + 'o',
  '.' + r('o', 12) + '.',
  r('.', 5) + 'oMMo' + r('.', 5),
  r('.', 3) + r('o', 8) + r('.', 3),
]);

export const PLANT = sprite([
  '.....gg.....',
  '...gg.gg.g..',
  '..gGgggGgg..',
  '.gGggGggGgg.',
  'gGgg.ggGggGg',
  '.ggGggggGgg.',
  '..gggGGggg..',
  '...gg..gg...',
  '....oooo....',
  '...oqqqqo...',
  '...oqqqqo...',
  '...oQQQQo...',
  '....oooo....',
]);

export const ALL_SPRITES: Readonly<Record<string, Sprite>> = {
  CHARACTER_SHORT,
  CHARACTER_LONG,
  CHAIR,
  DESK,
  MONITOR,
  PLANT,
};

// ---------------------------------------------------------------- colour helpers

/** Multiplies RGB channels by `factor` (clamped). >1 lightens, <1 darkens. */
export function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((n >> shift) & 0xff) * factor)));
  const out = (ch(16) << 16) | (ch(8) << 8) | ch(0);
  return `#${out.toString(16).padStart(6, '0')}`;
}
