import { describe, expect, it } from 'vitest';
import { agentView } from '../src/office/agentView';
import { BUBBLE_H, BUBBLE_W, bubblePixels, dotPixels } from '../src/office/badges';
import {
  allLookFiles,
  ARM_X,
  ARM_Y,
  assignLooks,
  composeCharacter,
  FRAME_H,
  FRAME_W,
  LOOKS,
  lookFiles,
  PARTS,
  RAISED_ARM,
  SHEET_H,
  SHEET_W,
  type Look,
} from '../src/office/characters';
import { FURNITURE } from '../src/office/furniture';
import {
  colorize,
  createPixels,
  crop,
  drawOver,
  getPixel,
  isOpaqueAt,
  redScreen,
  setPixel,
  swapColours,
  topRow,
  type Pixels,
} from '../src/office/pixels';
import { allThemes, FLOOR_TILES, roomTheme } from '../src/office/rooms';

describe('pixels', () => {
  it('colorize keeps alpha and maps grey to the requested hue', () => {
    const p = createPixels(2, 1);
    setPixel(p, 0, 0, [128, 128, 128, 255]);
    const out = colorize(p, { h: 120, s: 100, b: 0, c: 0 });
    const [r, g, b, a] = getPixel(out, 0, 0);
    expect(a).toBe(255);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(getPixel(out, 1, 0)[3]).toBe(0);
    // The source is not touched.
    expect(getPixel(p, 0, 0)).toEqual([128, 128, 128, 255]);
  });

  it('colorize: brightness -100 and zero saturation give black', () => {
    const p = createPixels(1, 1);
    setPixel(p, 0, 0, [100, 100, 100, 255]);
    expect(getPixel(colorize(p, { h: 0, s: 0, b: -100, c: 0 }), 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it('swapColours replaces exact colours only', () => {
    const p = createPixels(2, 1);
    setPixel(p, 0, 0, [0x49, 0x3e, 0x38, 255]);
    setPixel(p, 1, 0, [1, 2, 3, 255]);
    const out = swapColours(p, { '#493E38': '#705e56' });
    expect(getPixel(out, 0, 0)).toEqual([0x70, 0x5e, 0x56, 255]);
    expect(getPixel(out, 1, 0)).toEqual([1, 2, 3, 255]);
  });

  it('redScreen turns green screen pixels red and leaves the rest', () => {
    const p = createPixels(2, 1);
    setPixel(p, 0, 0, [60, 200, 90, 255]);
    setPixel(p, 1, 0, [200, 200, 200, 255]);
    const out = redScreen(p);
    const [r, g] = getPixel(out, 0, 0);
    expect(r).toBeGreaterThan(g);
    expect(getPixel(out, 1, 0)).toEqual([200, 200, 200, 255]);
  });

  it('drawOver, crop and topRow', () => {
    const a = createPixels(4, 4);
    const b = createPixels(4, 4);
    setPixel(b, 2, 1, [9, 9, 9, 255]);
    setPixel(b, 3, 3, [9, 9, 9, 10]); // nearly transparent: ignored
    drawOver(a, b);
    expect(isOpaqueAt(a, 2, 1)).toBe(true);
    expect(isOpaqueAt(a, 3, 3)).toBe(false);
    expect(topRow(a)).toBe(1);
    expect(getPixel(crop(a, 2, 1, 2, 2), 0, 0)).toEqual([9, 9, 9, 255]);
    expect(() => drawOver(a, createPixels(2, 2))).toThrow();
  });
});

/** A fake 128x96 layer: `fill` the whole back-view row with one colour, or only some pixels. */
function sheet(fill: (x: number, y: number) => readonly number[] | null): Pixels {
  const p = createPixels(SHEET_W, SHEET_H);
  for (let y = 0; y < SHEET_H; y++) {
    for (let x = 0; x < SHEET_W; x++) {
      const c = fill(x, y);
      if (c) setPixel(p, x, y, c);
    }
  }
  return p;
}

function fakeSheets(look: Look, sleeves: 'short' | 'long'): Map<string, Pixels> {
  const sheets = new Map<string, Pixels>();
  const inFrame = (x: number, y: number) => ({ fx: x % FRAME_W, fy: y % FRAME_H });
  for (const file of lookFiles(look)) {
    if (file === 'body/flat.png') {
      // Head rows 4-16, torso and hanging hands 17-25 (skin), outline colour at x 14.
      sheets.set(
        file,
        sheet((x, y) => {
          const { fx, fy } = inFrame(x, y);
          if (fy < 4 || fy > 25 || fx < 1 || fx > 14) return null;
          return fx === 14 ? [0x49, 0x3e, 0x38, 255] : [0xe9, 0xa3, 0x84, 255];
        }),
      );
    } else if (file.startsWith('top/') || file.startsWith('jacket/')) {
      const bottom = sleeves === 'long' ? 23 : 20;
      sheets.set(
        file,
        sheet((x, y) => {
          const { fx, fy } = inFrame(x, y);
          return fy >= 18 && fy <= bottom && fx >= 2 && fx <= 13 ? [110, 110, 110, 255] : null;
        }),
      );
    } else {
      sheets.set(
        file,
        sheet((x, y) =>
          inFrame(x, y).fy === 3 && inFrame(x, y).fx === 8 ? [90, 90, 90, 255] : null,
        ),
      );
    }
  }
  return sheets;
}

describe('characters', () => {
  it('every look uses only shipped layer files', () => {
    for (const look of LOOKS) {
      for (const slot of ['hair', 'top', 'pants', 'jacket', 'hat'] as const) {
        const part = look[slot];
        if (part) expect(PARTS[slot]).toContain(part.id);
      }
    }
    expect(allLookFiles()).toContain('body/flat.png');
  });

  it('assignLooks is stable and gives distinct looks while there are enough', () => {
    const ids = [
      'coordinator',
      'opportunity-hunter',
      'crypto-analyst',
      'community-bot',
      'news-worker',
      'watchdog',
      'archivist',
      'claude-code-1',
      'claude-code-2',
    ];
    const a = assignLooks(ids);
    const b = assignLooks([...ids].reverse());
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    expect(new Set(a.values()).size).toBe(ids.length);
    const crowd = Array.from({ length: LOOKS.length + 3 }, (_, i) => `agent-${i}`);
    const many = assignLooks(crowd);
    expect(many.size).toBe(crowd.length);
    for (const v of many.values()) expect(v).toBeLessThan(LOOKS.length);
  });

  it('composes a 16x32 seated frame and two raised-hand frames', () => {
    const look = LOOKS[0] as Look;
    const frames = composeCharacter(look, fakeSheets(look, 'short'));
    expect(frames.seated.width).toBe(FRAME_W);
    expect(frames.seated.height).toBe(FRAME_H);
    expect(frames.headTop).toBe(3); // the fake hair pixel at row 3
    for (const raised of frames.raised) {
      expect(raised.width).toBe(FRAME_W);
      expect(raised.height).toBe(FRAME_H);
    }
    // The hand is up above the head: opaque pixels where the seated frame has none.
    expect(isOpaqueAt(frames.seated, ARM_X + 1, ARM_Y + 1)).toBe(false);
    expect(isOpaqueAt(frames.raised[0], ARM_X + 1, ARM_Y + 1)).toBe(true);
    // The sway frame leans the hand one pixel left.
    expect(isOpaqueAt(frames.raised[1], ARM_X, ARM_Y + 1)).toBe(true);
    expect(frames.raised[0]).not.toEqual(frames.raised[1]);
  });

  it('the raised arm takes skin under short sleeves and sleeve colour under long ones', () => {
    const look = LOOKS[1] as Look; // no jacket
    const forearm = { x: ARM_X + 3, y: ARM_Y + 6 };
    const short = composeCharacter(look, fakeSheets(look, 'short'));
    const long = composeCharacter(look, fakeSheets(look, 'long'));
    const skinPx = getPixel(short.raised[0], forearm.x, forearm.y);
    const sleevePx = getPixel(long.raised[0], forearm.x, forearm.y);
    expect(skinPx[0]).toBeGreaterThan(skinPx[2] + 40); // warm skin tone
    expect(Math.abs(sleevePx[0] - sleevePx[2])).toBeLessThan(40); // the (recoloured) shirt
  });

  it('rejects layers of the wrong size or missing layers', () => {
    const look = LOOKS[0] as Look;
    const sheets = fakeSheets(look, 'short');
    sheets.set('body/flat.png', createPixels(16, 32));
    expect(() => composeCharacter(look, sheets)).toThrow(/want 128x96/);
    sheets.delete('body/flat.png');
    expect(() => composeCharacter(look, sheets)).toThrow(/missing/);
  });

  it('the raised-arm template has rows of equal width', () => {
    for (const row of RAISED_ARM) expect(row.length).toBe(RAISED_ARM[0]?.length);
    expect(ARM_X + (RAISED_ARM[0]?.length ?? 0)).toBeLessThanOrEqual(FRAME_W);
  });
});

describe('agentView: sprite and frame by status', () => {
  it('working: seated, monitor cycles 3 frames every 400 ms, green dot', () => {
    const frames = [0, 400, 800, 1200].map((t) => agentView('working', t, false));
    expect(frames.map((f) => f.monitor)).toEqual(['on-1', 'on-2', 'on-3', 'on-1']);
    expect(frames.every((f) => f.pose === 'seated' && f.badge === 'dot')).toBe(true);
  });

  it('waiting for you: raised hand that sways every 600 ms and a hopping "!"', () => {
    expect(agentView('waiting_you', 0, false)).toMatchObject({
      pose: 'hand-up',
      badge: 'bang',
      lift: 0,
    });
    expect(agentView('waiting_you', 650, false).pose).toBe('hand-up-sway');
    expect(agentView('waiting_you', 850, false).lift).toBe(1);
  });

  it('waiting for a service: lit monitor and an hourglass', () => {
    expect(agentView('waiting_external', 500, false)).toEqual({
      pose: 'seated',
      monitor: 'on-1',
      badge: 'hourglass',
      lift: 0,
    });
  });

  it('error: red monitor and a cross', () => {
    expect(agentView('error', 0, false)).toMatchObject({ monitor: 'error', badge: 'cross' });
  });

  it('idle: lit monitor without blinking, no badge', () => {
    for (const t of [0, 400, 800]) {
      expect(agentView('idle', t, false)).toEqual({
        pose: 'seated',
        monitor: 'on-1',
        badge: null,
        lift: 0,
      });
    }
  });

  it('offline: empty chair, monitor off', () => {
    expect(agentView('offline', 0, false)).toEqual({
      pose: 'absent',
      monitor: 'off',
      badge: null,
      lift: 0,
    });
  });

  it('reduced motion: nothing moves', () => {
    for (const t of [0, 450, 700, 900, 1300]) {
      expect(agentView('working', t, true).monitor).toBe('on-1');
      expect(agentView('waiting_you', t, true)).toMatchObject({ pose: 'hand-up', lift: 0 });
    }
  });
});

describe('badges and themes', () => {
  it('bubbles are 11x13 with a frame and a glyph', () => {
    for (const kind of ['bang', 'hourglass', 'cross'] as const) {
      const b = bubblePixels(kind);
      expect([b.width, b.height]).toEqual([BUBBLE_W, BUBBLE_H]);
      expect(isOpaqueAt(b, 0, 0)).toBe(true);
      expect(isOpaqueAt(b, 0, 12)).toBe(false);
      expect(getPixel(b, 5, 4)).toEqual(getPixel(b, 0, 0)); // glyph in ink
    }
    expect(dotPixels().width).toBe(6);
  });

  it('room ids that are Object.prototype names get a normal fallback theme', () => {
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const theme = roomTheme(id);
      expect(allThemes()).toContain(theme);
      expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(roomTheme('hq').accent).toBe('#f2b84b');
  });

  it('themes only use shipped floors and furniture', () => {
    for (const theme of allThemes()) {
      expect(FLOOR_TILES).toContain(theme.floor.tile);
      for (const spec of [...theme.wall, ...theme.floorDecor]) {
        for (const part of spec.parts) expect(FURNITURE[part.id]).toBeDefined();
      }
      expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
