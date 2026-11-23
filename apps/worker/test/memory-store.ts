import type { FeedEvent } from '@ai-office/protocol';
import type { OfficeStore, PersistedSnapshot, StoredSnapshot } from '../src/core.js';

/** In-memory OfficeStore for tests (the Durable Object uses SQLite). */
export class MemoryOfficeStore implements OfficeStore {
  private stored: PersistedSnapshot | null;
  private feed: FeedEvent[];
  saves = 0;

  /** `seed` stands in for what an older deployment left in storage (oldest feed event first). */
  constructor(seed: { snapshot?: PersistedSnapshot; feed?: FeedEvent[] } = {}) {
    this.stored = seed.snapshot ?? null;
    this.feed = [...(seed.feed ?? [])];
  }

  loadSnapshot(): PersistedSnapshot | null {
    return this.stored;
  }
  saveSnapshot(value: StoredSnapshot): void {
    this.stored = structuredClone(value);
    this.saves++;
  }
  loadFeed(limit: number): FeedEvent[] {
    return this.feed.slice(-limit).reverse();
  }
  appendFeed(events: FeedEvent[]): FeedEvent[] {
    const ids = new Set(this.feed.map((e) => e.id));
    const fresh = events.filter((e) => !ids.has(e.id));
    this.feed.push(...fresh);
    return fresh;
  }
  trimFeed(keep: number): void {
    if (this.feed.length > keep) this.feed = this.feed.slice(-keep);
  }
}
