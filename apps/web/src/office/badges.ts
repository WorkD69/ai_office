/**
 * Status badges beside an agent's head: our own pixel art (the "waiting" bubble is an idea
 * from Pixel Agents, not their sprite). Colours are the design tokens from styles.css.
 */
import { createPixels, parseHex, setPixel, type Pixels } from './pixels';

export type BubbleKind = 'bang' | 'hourglass' | 'cross';

export const BADGE_COLOURS = {
  ink: '#1d1a29', // --surface
  warn: '#ffd24a',
  info: '#79bcff',
  bad: '#ff5a5f',
  ok: '#6cd46c',
} as const;

export const BUBBLE_W = 11;
export const BUBBLE_H = 13;

/** Glyphs on the 9x8 inner area of the bubble, `#` = ink. */
const GLYPHS: Readonly<Record<BubbleKind, readonly string[]>> = {
  bang: [
    '.........',
    '....#....',
    '....#....',
    '....#....',
    '....#....',
    '.........',
    '....#....',
    '.........',
  ],
  hourglass: [
    '.........',
    '..#####..',
    '...#.#...',
    '....#....',
    '...###...',
    '..#####..',
    '.........',
    '.........',
  ],
  cross: [
    '.........',
    '..#...#..',
    '...#.#...',
    '....#....',
    '...#.#...',
    '..#...#..',
    '.........',
    '.........',
  ],
};

const FILL: Readonly<Record<BubbleKind, string>> = {
  bang: BADGE_COLOURS.warn,
  hourglass: BADGE_COLOURS.info,
  cross: BADGE_COLOURS.bad,
};

const rgba = (hex: string) => [...parseHex(hex), 255];

/** An 11x13 speech bubble: 1 px ink frame, coloured inside, glyph in ink, tail pointing down. */
export function bubblePixels(kind: BubbleKind): Pixels {
  const out = createPixels(BUBBLE_W, BUBBLE_H);
  const ink = rgba(BADGE_COLOURS.ink);
  const fill = rgba(FILL[kind]);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < BUBBLE_W; x++) {
      const edge = x === 0 || y === 0 || x === BUBBLE_W - 1 || y === 9;
      setPixel(out, x, y, edge ? ink : fill);
    }
  }
  // Tail under the bubble.
  for (let x = 4; x <= 6; x++) setPixel(out, x, 10, ink);
  setPixel(out, 5, 10, fill);
  setPixel(out, 5, 11, ink);
  GLYPHS[kind].forEach((row, gy) => {
    for (let gx = 0; gx < row.length; gx++) if (row[gx] === '#') setPixel(out, gx + 1, gy + 1, ink);
  });
  return out;
}

export const DOT_SIZE = 6;

/** The "working" badge: a green square with an ink frame. */
export function dotPixels(): Pixels {
  const out = createPixels(DOT_SIZE, DOT_SIZE);
  for (let y = 0; y < DOT_SIZE; y++) {
    for (let x = 0; x < DOT_SIZE; x++) {
      const edge = x === 0 || y === 0 || x === DOT_SIZE - 1 || y === DOT_SIZE - 1;
      setPixel(out, x, y, rgba(edge ? BADGE_COLOURS.ink : BADGE_COLOURS.ok));
    }
  }
  return out;
}
