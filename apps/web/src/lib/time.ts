const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/**
 * "5 min ago" / "in 3 hours" / "just now". Returns null for a missing date so callers
 * can render their own placeholder.
 */
export function formatRelative(
  iso: string | null,
  now: number,
  lang: string,
  justNow: string,
): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const diffSec = (then - now) / 1000;
  const abs = Math.abs(diffSec);
  if (abs < 45) return justNow;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  for (const [unit, seconds] of UNITS) {
    if (abs >= seconds || unit === 'minute') {
      // Truncate, never round up: 23.6 h is "23 hr ago", not "24 hr ago" (which reads as a day).
      // Minutes start at 1 so that 45–59 s does not become "0 min ago".
      const value = Math.max(1, Math.floor(abs / seconds));
      return rtf.format(diffSec < 0 ? -value : value, unit);
    }
  }
  return justNow;
}

export function formatClock(iso: string | null, lang: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

/** 1234567 -> "1.2M", 15300 -> "15.3k". */
export function formatCompact(n: number, lang: string): string {
  return new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** A duration for sentences like "data is 7 minutes old": minutes below 2 h, then hours. */
export function formatAge(ms: number, lang: string): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const [value, unit] = minutes < 120 ? [minutes, 'minute'] : [Math.floor(minutes / 60), 'hour'];
  return new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}
