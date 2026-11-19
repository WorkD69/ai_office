/** FNV-1a 32-bit. Small, fast and stable across runs: used for deterministic sprite variants. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Picks an element deterministically; `salt` decorrelates several picks from one id. */
export function pick<T>(items: readonly T[], id: string, salt: string): T {
  if (items.length === 0) throw new Error('pick() from an empty list');
  return items[hash32(`${salt}:${id}`) % items.length] as T;
}
