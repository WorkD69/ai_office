/**
 * Characters from Pixel Agents' wardrobe layers (MIT, (c) 2026 Pablo De Lucca; based on
 * JIK-A-4's MetroCity, CC0). Only the geometry of their 128x96 sheets is used here: 3 rows
 * (down, up, right) x 8 columns of 16x32 frames; column 1 is the standing walk frame and
 * column 7 the seated frame. Our agents sit with their backs to the viewer: row 1 ("up").
 *
 * Pure functions over pixel buffers; loading the PNGs lives in `art.ts`.
 */
import { hash32 } from './hash';
import {
  clonePixels,
  colorize,
  createPixels,
  crop,
  drawOver,
  getPixel,
  isOpaqueAt,
  setPixel,
  swapColours,
  topRow,
  type Hsbc,
  type Pixels,
} from './pixels';

export const FRAME_W = 16;
export const FRAME_H = 32;
export const SHEET_W = FRAME_W * 8;
export const SHEET_H = FRAME_H * 3;
/** Sheet row of the back view. */
export const ROW_UP = 1;
/** Sheet column of the standing frame (arms hanging at the sides). */
export const COL_STANDING = 1;
/** Sheet column of the seated frame. */
export const COL_SEATED = 7;

export type Skin = 'base' | 'pale' | 'tan' | 'dark';
export type Slot = 'pants' | 'top' | 'jacket' | 'hair' | 'hat';

/** Layer files available in `public/pixel-agents/characters/<slot>/<id>.png`. */
export const PARTS: Readonly<Record<Slot, readonly string[]>> = {
  pants: ['jeans', 'skirt'],
  top: ['tshirt', 'long_sleeved_shirt', 'turtleneck'],
  jacket: ['blazer', 'vest', 'bomber'],
  hair: ['short', 'bob', 'mop', 'spiky', 'slicked_back', 'high_ponytail', 'long_waves', 'parted'],
  hat: ['badge_cap'],
};

/** Draw order above the body, bottom to top (Pixel Agents' layer order for these slots). */
export const LAYER_ORDER: readonly Slot[] = ['pants', 'top', 'jacket', 'hair', 'hat'];

export interface Part {
  id: string;
  colour: Hsbc;
}

export interface Look {
  skin: Skin;
  hair: Part;
  top: Part;
  pants: Part;
  jacket?: Part;
  hat?: Part;
}

/** Skin tones of the "flat" body: exact colour swaps from Pixel Agents' wardrobe.json. */
export const SKIN_SWAPS: Readonly<Record<Exclude<Skin, 'base'>, Record<string, string>>> = {
  pale: {
    '#493e38': '#705e56',
    '#e9a384': '#fcd6c4',
    '#fbbf97': '#ffede5',
    '#e29878': '#cf9d86',
    '#c5896e': '#e1aa91',
    '#ffd8b2': '#fff6f2',
    '#84523a': '#ba917e',
    '#ffa172': '#fff7f4',
    '#ffc694': '#fff7f4',
  },
  tan: {
    '#493e38': '#423732',
    '#e9a384': '#b67352',
    '#fbbf97': '#e08d64',
    '#e29878': '#ac6847',
    '#c5896e': '#8c583f',
    '#ffd8b2': '#ffa77c',
    '#ffc694': '#ffa172',
  },
  dark: {
    '#493e38': '#231e1d',
    '#e9a384': '#5f4132',
    '#fbbf97': '#75503d',
    '#e29878': '#593b2c',
    '#c5896e': '#493227',
    '#ffd8b2': '#865e4c',
    '#84523a': '#452e24',
    '#ffa172': '#855b46',
    '#403632': '#221e1c',
    '#ffc694': '#855b46',
  },
};

const c = (h: number, s: number, b: number, k = 0): Hsbc => ({ h, s, b, c: k });
const p = (id: string, colour: Hsbc): Part => ({ id, colour });

/** A small cast of outfits; agents get distinct ones while there are enough. */
export const LOOKS: readonly Look[] = [
  {
    skin: 'base',
    hair: p('short', c(25, 45, -50)),
    top: p('long_sleeved_shirt', c(0, 0, 0)),
    jacket: p('blazer', c(225, 35, -45)),
    pants: p('jeans', c(220, 25, -55)),
  },
  {
    skin: 'pale',
    hair: p('high_ponytail', c(18, 60, -30)),
    top: p('tshirt', c(140, 35, -35)),
    pants: p('jeans', c(215, 30, -45)),
  },
  {
    skin: 'tan',
    hair: p('slicked_back', c(0, 0, -70)),
    top: p('turtleneck', c(0, 0, -62)),
    pants: p('jeans', c(0, 0, -50)),
  },
  {
    skin: 'base',
    hair: p('spiky', c(30, 25, -55)),
    top: p('tshirt', c(280, 35, -30)),
    pants: p('jeans', c(30, 15, -35)),
  },
  {
    skin: 'dark',
    hair: p('bob', c(40, 55, -15)),
    top: p('tshirt', c(205, 55, -30)),
    pants: p('skirt', c(0, 0, -55)),
  },
  {
    skin: 'tan',
    hair: p('short', c(0, 0, -65)),
    hat: p('badge_cap', c(355, 55, -30)),
    top: p('tshirt', c(0, 0, -25)),
    pants: p('jeans', c(220, 30, -45)),
  },
  {
    skin: 'pale',
    hair: p('long_waves', c(0, 0, -10)),
    top: p('long_sleeved_shirt', c(30, 30, -45)),
    jacket: p('vest', c(30, 35, -60)),
    pants: p('skirt', c(0, 0, -50)),
  },
  {
    skin: 'base',
    hair: p('mop', c(20, 70, -20)),
    top: p('tshirt', c(25, 75, -15)),
    pants: p('jeans', c(220, 20, -60)),
  },
  {
    skin: 'dark',
    hair: p('parted', c(0, 0, -72)),
    top: p('long_sleeved_shirt', c(200, 30, -20)),
    jacket: p('bomber', c(150, 30, -45)),
    pants: p('jeans', c(0, 0, -55)),
  },
  {
    skin: 'pale',
    hair: p('bob', c(5, 60, -25)),
    top: p('turtleneck', c(340, 40, -30)),
    pants: p('skirt', c(230, 20, -50)),
  },
  {
    skin: 'tan',
    hair: p('mop', c(0, 0, -75)),
    top: p('tshirt', c(50, 70, -15)),
    pants: p('jeans', c(210, 25, -40)),
  },
  {
    skin: 'base',
    hair: p('parted', c(35, 50, -30)),
    top: p('long_sleeved_shirt', c(190, 45, -30)),
    jacket: p('blazer', c(0, 0, -55)),
    pants: p('jeans', c(220, 25, -50)),
  },
];

/**
 * Gives every agent a look: its hash picks a preferred one, and agents that would repeat a
 * look already taken (in id order) move to the next free one. Stable for a stable roster.
 */
export function assignLooks(agentIds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  for (const id of [...new Set(agentIds)].sort()) {
    let index = hash32(`look:${id}`) % LOOKS.length;
    if (taken.size < LOOKS.length) {
      while (taken.has(index)) index = (index + 1) % LOOKS.length;
    }
    taken.add(index);
    out.set(id, index);
  }
  return out;
}

/** Layer paths (relative to the characters folder) a look needs, body first. */
export function lookFiles(look: Look): string[] {
  const files = ['body/flat.png'];
  for (const slot of LAYER_ORDER) {
    const part = look[slot];
    if (part) files.push(`${slot}/${part.id}.png`);
  }
  return files;
}

/** Every layer file any look uses (what the loader fetches). */
export function allLookFiles(): string[] {
  return [...new Set(LOOKS.flatMap(lookFiles))].sort();
}

export interface CharacterFrames {
  /** Sitting, back to the viewer. */
  seated: Pixels;
  /** Sitting with the right hand raised, two sway positions. */
  raised: readonly [Pixels, Pixels];
  /** First opaque row of the seated frame (top of the hair or hat). */
  headTop: number;
}

/** Builds a look's frames from its decoded layer sheets (128x96 each, keyed like `lookFiles`). */
export function composeCharacter(look: Look, sheets: ReadonlyMap<string, Pixels>): CharacterFrames {
  const sheet = (file: string): Pixels => {
    const s = sheets.get(file);
    if (!s) throw new Error(`character layer missing: ${file}`);
    if (s.width !== SHEET_W || s.height !== SHEET_H) {
      throw new Error(
        `character layer ${file} is ${s.width}x${s.height}, want ${SHEET_W}x${SHEET_H}`,
      );
    }
    return s;
  };
  const bodySrc = sheet('body/flat.png');
  const body =
    look.skin === 'base' ? clonePixels(bodySrc) : swapColours(bodySrc, SKIN_SWAPS[look.skin]);
  const full = clonePixels(body);
  const clothes = createPixels(SHEET_W, SHEET_H);
  for (const slot of LAYER_ORDER) {
    const part = look[slot];
    if (!part) continue;
    const layer = colorize(sheet(`${slot}/${part.id}.png`), part.colour);
    drawOver(full, layer);
    drawOver(clothes, layer);
  }
  const frame = (src: Pixels, col: number) =>
    crop(src, col * FRAME_W, ROW_UP * FRAME_H, FRAME_W, FRAME_H);
  const seated = frame(full, COL_SEATED);
  const arm = {
    body: frame(body, COL_STANDING),
    full: frame(full, COL_STANDING),
    clothes: frame(clothes, COL_STANDING),
  };
  return {
    seated,
    raised: [raiseHand(seated, arm, 0), raiseHand(seated, arm, 1)],
    headTop: Math.max(0, topRow(seated)),
  };
}

/**
 * The raised right arm, drawn in the character's own colours. Keys: O skin outline, s skin,
 * S skin shade, o sleeve outline, f sleeve, h sleeve highlight. Rows 4-8 are the forearm:
 * skin under short sleeves, sleeve when the clothes cover the forearm.
 */
export const RAISED_ARM: readonly string[] = [
  '.O.O.',
  'OsOsO',
  'OsssO',
  'OsssO',
  'OSssO',
  'OSssO',
  'OSssO',
  'OSssO',
  'OSssO',
  'ooooo',
  'offho',
  'offho',
  'offho',
  'offho',
  'offho',
  'offho',
  'offho',
  'offho',
];
export const ARM_X = 11;
export const ARM_Y = 0;
const FOREARM = { from: 4, to: 8 };
/** Rows of the arm (hand and wrist) that lean sideways in the second sway frame. */
const SWAY_ROWS = 7;

interface ArmSource {
  /** Standing back frame of the body alone (skin tones). */
  body: Pixels;
  /** Standing back frame with clothes. */
  full: Pixels;
  /** Standing back frame of the clothes alone (what covers the arm). */
  clothes: Pixels;
}

/**
 * Derives the "hand up" frame from the seated frame: colours are sampled from the standing
 * frame's right arm (sleeve at the shoulder, skin of the hanging hand), so every outfit and
 * skin tone gets a matching arm, and the arm rises beside the head.
 */
export function raiseHand(seated: Pixels, src: ArmSource, sway: 0 | 1): Pixels {
  const out = clonePixels(seated);
  const covered = isOpaqueAt(src.clothes, 12, 21);
  const palette: Record<string, readonly number[]> = {
    O: getPixel(src.body, 14, 22),
    s: getPixel(src.body, 12, 22),
    S: getPixel(src.body, 13, 21),
    o: getPixel(src.full, 13, 19),
    f: getPixel(src.full, 11, 19),
    h: getPixel(src.full, 12, 19),
  };
  const sleeveFor: Record<string, string> = { O: 'o', S: 'f', s: 'h' };
  RAISED_ARM.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      let key = row[x] as string;
      if (key === '.') continue;
      if (covered && y >= FOREARM.from && y <= FOREARM.to) key = sleeveFor[key] ?? key;
      const colour = palette[key];
      if (!colour) continue;
      const dx = sway && y < SWAY_ROWS ? -1 : 0;
      setPixel(out, ARM_X + x + dx, ARM_Y + y, [
        colour[0] ?? 0,
        colour[1] ?? 0,
        colour[2] ?? 0,
        255,
      ]);
    }
  });
  return out;
}
