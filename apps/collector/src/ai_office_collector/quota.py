"""Convert ``hermes usage --json`` output into the protocol ``Quota`` shape.

``hermes usage`` (Hermes v0.21.6+) fetches the provider's account rate-limit
windows, the same data as the ``/usage`` slash command. According to its ``--help``
it only queries an account endpoint and does not run the model (not independently
measured). Plan names and free-form ``details`` lines are dropped on purpose.
"""

from __future__ import annotations

from typing import Any

from .sanitize import clean_text
from .timeutil import iso, parse_ts

# Codex labels -> short names shown on the quota meter.
_LABELS = {"session": "5h", "weekly": "week"}


def quota_from_hermes_usage(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or raw.get("unavailable_reason"):
        return None
    provider = clean_text(raw.get("provider"), 40)
    observed = parse_ts(raw.get("fetched_at"))
    windows_raw = raw.get("windows")
    if provider is None or observed is None or not isinstance(windows_raw, list):
        return None

    windows: list[dict[str, Any]] = []
    for w in windows_raw:
        if not isinstance(w, dict):
            continue
        label = str(w.get("label") or "")
        name = _LABELS.get(label.lower()) or clean_text(label, 20)
        used = w.get("used_percent")
        if not name or isinstance(used, bool) or not isinstance(used, int | float):
            continue
        windows.append(
            {
                "name": name,
                "usedPercent": round(min(max(float(used), 0.0), 100.0), 1),
                "resetsAt": iso(parse_ts(w.get("resets_at"))),
            }
        )
        if len(windows) == 4:
            break
    return {"provider": provider, "windows": windows, "observedAt": iso(observed)}
