import { FEED_LIMIT, type FeedEvent } from '@ai-office/protocol';

/** Newest first, compared as instants (not strings, so any ISO offset sorts correctly). */
export function sortFeed(events: readonly FeedEvent[], limit = FEED_LIMIT): FeedEvent[] {
  const at = (e: FeedEvent) => {
    const t = Date.parse(e.at);
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...events].sort((a, b) => at(b) - at(a)).slice(0, limit);
}
