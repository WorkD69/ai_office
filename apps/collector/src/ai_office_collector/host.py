"""Host probes: systemd unit states and basic resource metrics (Linux only)."""

from __future__ import annotations

import logging
import os
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

log = logging.getLogger(__name__)

SYSTEMCTL = "/usr/bin/systemctl"


@dataclass(frozen=True)
class HostMetrics:
    mem_used_mb: float
    mem_total_mb: float
    disk_used_percent: float
    load1: float


class SystemProbe(Protocol):
    def unit_states(self, units: tuple[str, ...]) -> dict[str, str]: ...

    def metrics(self) -> HostMetrics | None: ...


class LinuxProbe:
    """Real probe. ``systemctl is-active`` works unprivileged and without network."""

    def unit_states(self, units: tuple[str, ...]) -> dict[str, str]:
        if not units:
            return {}
        try:
            # Fixed argv, no shell; unit names are validated by the config loader.
            proc = subprocess.run(
                [SYSTEMCTL, "is-active", "--", *units],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            log.warning("systemctl is-active failed: %s", type(exc).__name__)
            return dict.fromkeys(units, "unknown")
        lines = proc.stdout.splitlines()
        return {u: (lines[i].strip() if i < len(lines) else "unknown") for i, u in enumerate(units)}

    def metrics(self) -> HostMetrics | None:
        try:
            return read_metrics(Path("/proc"), Path("/"))
        except (OSError, ValueError, KeyError) as exc:
            log.warning("host metrics unavailable: %s", type(exc).__name__)
            return None


def read_metrics(
    proc: Path, root: Path, statvfs: Callable[[Path], Any] | None = None
) -> HostMetrics:
    meminfo: dict[str, int] = {}
    for line in (proc / "meminfo").read_text().splitlines():
        key, _, rest = line.partition(":")
        parts = rest.split()
        if parts:
            meminfo[key] = int(parts[0])  # kB
    total_kb = meminfo["MemTotal"]
    available_kb = meminfo.get("MemAvailable", meminfo.get("MemFree", 0))

    st = (statvfs or os.statvfs)(root)  # os.statvfs is POSIX-only; injectable for tests
    total = st.f_blocks * st.f_frsize
    free_for_users = st.f_bavail * st.f_frsize
    used = total - st.f_bfree * st.f_frsize
    # Same formula as `df`: used / (used + available to unprivileged users).
    denom = used + free_for_users
    disk_pct = (used / denom * 100.0) if denom else 0.0

    load1 = float((proc / "loadavg").read_text().split()[0])
    return HostMetrics(
        mem_used_mb=round((total_kb - available_kb) / 1024, 1),
        mem_total_mb=round(total_kb / 1024, 1),
        disk_used_percent=round(min(max(disk_pct, 0.0), 100.0), 1),
        load1=max(load1, 0.0),
    )
