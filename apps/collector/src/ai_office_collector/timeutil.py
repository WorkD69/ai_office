"""Timestamp helpers. Hermes stores epoch floats in SQLite and ISO strings in JSON."""

from __future__ import annotations

from datetime import UTC, datetime, tzinfo


def parse_ts(value: object) -> datetime | None:
    """Parse an epoch number or ISO-8601 string into an aware UTC datetime."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        if value <= 0:
            return None
        try:
            return datetime.fromtimestamp(float(value), tz=UTC)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return parse_ts(float(text))
        except ValueError:
            pass
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    return None


def iso(dt: datetime | None) -> str | None:
    """Format as ``2026-11-19T10:00:00.000Z`` (accepted by zod ``datetime({offset:true})``)."""
    if dt is None:
        return None
    return dt.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def local_midnight(now: datetime, tz: tzinfo | None) -> datetime:
    """Start of the current day in ``tz`` (system local time when None), as UTC."""
    local = now.astimezone(tz) if tz is not None else now.astimezone()
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
