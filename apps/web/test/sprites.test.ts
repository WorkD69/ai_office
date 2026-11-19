import { describe, expect, it } from 'vitest';
import {
  ALL_SPRITES,
  BASE_PALETTE,
  characterVariant,
  shade,
  TRANSPARENT,
} from '../src/office/sprites';

const VARIANT_KEYS = ['s', 'S', 'h', 'H', 'c', 'C'];

describe('sprites', () => {
  for (const [name, sprite] of Object.entries(ALL_SPRITES)) {
    it(`${name}: rectangular and uses only known palette keys`, () => {
      expect(sprite.rows.length).toBe(sprite.h);
      for (const row of sprite.rows) expect(row.length).toBe(sprite.w);
      const allowed = new Set([TRANSPARENT, ...Object.keys(BASE_PALETTE), ...VARIANT_KEYS]);
      for (const ch of sprite.rows.join('')) expect(allowed.has(ch)).toBe(true);
    });
  }

  it('character variants are deterministic and fill every variant key', () => {
    const a = characterVariant('coordinator');
    const b = characterVariant('coordinator');
    expect(a.key).toBe(b.key);
    for (const key of VARIANT_KEYS) expect(a.palette[key]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('different ids usually look different', () => {
    const keys = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => characterVariant(id).key),
    );
    expect(keys.size).toBeGreaterThan(4);
  });

  it('shade() clamps channels', () => {
    expect(shade('#808080', 2)).toBe('#ffffff');
    expect(shade('#808080', 0)).toBe('#000000');
    expect(shade('#102030', 1)).toBe('#102030');
  });
});
