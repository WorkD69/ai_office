import type { FeedEvent } from '@ai-office/protocol';
import type { OfficeStore, StoredSnapshot } from '../src/core.js';

/** In-memory OfficeStore for tests (the Durable Object uses SQLite). */
export class MemoryOfficeStore implements OfficeStore {
  private stored: StoredSnapshot | null = null;
  private feed: FeedEvent[] = [];
  saves = 0;

  loadSnapshot(): StoredSnapshot | null {
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
