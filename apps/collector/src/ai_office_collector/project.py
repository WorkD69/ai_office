"""Isolated mode: project the few fields the office needs out of Hermes state.

The ``project`` command runs as its own unprivileged user without network. It never sees
the Hermes data directory: systemd passes read-only copies of exactly two kinds of files via
``LoadCredential=`` (``gateway`` = ``gateway_state.json`` and ``cron-<profile>`` = that
profile's ``cron/jobs.json``). The projection keeps an allow-listed subset of fields and
writes it in the Hermes directory layout, plus ``unit_states.json`` with ``systemctl
is-active`` results. The exporter then reads this projection with
``read_session_state = false`` and also never touches Hermes data.

Trade-off: session databases are not projected, so isolated mode shows no ``working``
status and no token usage. See ``apps/collector/DEPLOY.md``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .config import Config, HermesSource
from .hermes import profile_home
from .host import SystemProbe
from .sanitize import clean_text
from .snapshot import write_atomic
from .timeutil import iso, parse_ts

GATEWAY_CREDENTIAL = "gateway"
MAX_INPUT_BYTES = 1024 * 1024
MAX_JOBS = 50

PLATFORM_STATES = frozenset({"connected", "connecting", "disconnected", "error", "stopped"})
JOB_RESULTS = frozenset({"ok", "success", "error", "failed"})
SCHEDULE_RE = re.compile(r"[\d\s,*:/+A-Za-z-]{1,80}")
JOB_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")


def cron_credential(profile: str) -> str:
    """Credential name systemd should use for a profile's ``cron/jobs.json``."""
    return f"cron-{profile}"


def project(config: Config, credentials: Path, output: Path, probe: SystemProbe) -> None:
    """Write the projection of ``credentials`` into ``output``.

    The gateway credential is required; missing cron credentials are fine (that profile
    simply has no scheduled jobs in the office).
    """
    hermes = [a.source for a in config.agents if isinstance(a.source, HermesSource)]
    platforms = tuple(dict.fromkeys(s.platform for s in hermes if s.platform))

    gateway = project_gateway(read_credential(credentials / GATEWAY_CREDENTIAL), platforms)
    write_atomic(output / "gateway_state.json", gateway)

    for profile in dict.fromkeys(s.profile for s in hermes):
        source = credentials / cron_credential(profile)
        jobs = project_jobs(read_credential(source)) if source.is_file() else []
        write_atomic(profile_home(output, profile) / "cron" / "jobs.json", {"jobs": jobs})

    write_atomic(output / "unit_states.json", probe.unit_states(config.all_units()))


def read_credential(path: Path) -> Any:
    with path.open("rb") as fh:
        body = fh.read(MAX_INPUT_BYTES + 1)
    if len(body) > MAX_INPUT_BYTES:
        raise ValueError(f"credential {path.name} is larger than {MAX_INPUT_BYTES} bytes")
    return json.loads(body)


def project_gateway(raw: Any, platforms: tuple[str, ...]) -> dict[str, Any]:
    """Keep running/stopped, the heartbeat time and allow-listed platform states only."""
    raw = raw if isinstance(raw, dict) else {}
    source_platforms = raw.get("platforms")
    source_platforms = source_platforms if isinstance(source_platforms, dict) else {}
    projected: dict[str, dict[str, str]] = {}
    for name in platforms:
        entry = source_platforms.get(name)
        if isinstance(entry, dict) and isinstance(entry.get("state"), str):
            state = entry["state"]
            projected[name] = {"state": state if state in PLATFORM_STATES else "unknown"}
    return {
        "gateway_state": "running" if raw.get("gateway_state") == "running" else "stopped",
        "updated_at": iso(parse_ts(raw.get("updated_at"))),
        "platforms": projected,
    }


def project_jobs(raw: Any) -> list[dict[str, Any]]:
    """Keep only display fields of cron jobs; prompts, scripts and delivery targets are dropped."""
    jobs = raw.get("jobs", []) if isinstance(raw, dict) else raw
    if not isinstance(jobs, list):
        return []
    result: list[dict[str, Any]] = []
    for index, job in enumerate(jobs[:MAX_JOBS], 1):
        if not isinstance(job, dict):
            continue
        schedule = job.get("schedule")
        expr = (
            schedule.get("expr") or schedule.get("display")
            if isinstance(schedule, dict)
            else schedule
        )
        if not isinstance(expr, str) or SCHEDULE_RE.fullmatch(expr) is None:
            expr = ""
        job_id = str(job.get("id", ""))
        state = job.get("state")
        result.append(
            {
                "id": job_id if JOB_ID_RE.fullmatch(job_id) else f"job-{index}",
                "name": clean_text(job.get("name"), 80) or f"Job {index}",
                "schedule": expr,
                "enabled": job.get("enabled", True) is True and state not in ("paused", "disabled"),
                "next_run_at": iso(parse_ts(job.get("next_run_at"))),
                "last_run_at": iso(parse_ts(job.get("last_run_at"))),
                "last_status": job.get("last_status")
                if job.get("last_status") in JOB_RESULTS
                else None,
            }
        )
    return result
