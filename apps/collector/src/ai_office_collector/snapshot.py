"""Builds the protocol ``Snapshot`` (see packages/protocol/src/schema.ts) and writes it."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .config import AgentConfig, Config, HermesSource, SystemdSource, resolve_timezone
from .hermes import StateDb, UsageToday, profile_home, read_cron_jobs, read_gateway
from .host import SystemProbe
from .protocol import MAX_QUOTAS, PROTOCOL_VERSION
from .sanitize import clean_text
from .status import GatewayView, SessionView, Verdict, hermes_status, reason, systemd_status
from .timeutil import iso, local_midnight, parse_ts

log = logging.getLogger(__name__)

Json = dict[str, Any]


def build_snapshot(config: Config, probe: SystemProbe, now: datetime | None = None) -> Json:
    now = now or datetime.now(UTC)
    s = config.settings
    midnight = local_midnight(now, resolve_timezone(s.timezone))
    gateway = read_gateway(s.hermes_home)
    unit_states = (
        probe.unit_states(config.all_units())
        if s.read_session_state
        else read_projected_unit_states(s.hermes_home)
    )

    agents: list[Json] = []
    for agent in config.agents:
        try:
            agents.append(_agent(agent, config, now, midnight, gateway, unit_states))
        except Exception as exc:  # one broken source must not hide the other agents
            log.warning("agent %s: %s", agent.id, type(exc).__name__)
            failure = reason("collector_error", error=type(exc).__name__)
            agents.append(_base(agent, Verdict("error", reason=failure)))

    quota = load_quota(s.quota_file) if s.quota_file else None
    return {
        "v": PROTOCOL_VERSION,
        "generatedAt": iso(now),
        "agents": agents,
        "quotas": [quota][:MAX_QUOTAS] if quota else [],
        "host": _host(probe, config, unit_states),
    }


#: Projected session facts older than this are ignored, so a stopped projection can never
#: keep an agent "working".
PROJECTION_MAX_AGE = timedelta(seconds=60)
_USAGE_KEYS = ("apiCalls", "inputTokens", "outputTokens", "cacheReadTokens")


def read_projected_session(
    home: Path, agent_id: str, now: datetime
) -> tuple[SessionView | None, UsageToday | None]:
    try:
        raw = json.loads((home / "sessions" / f"{agent_id}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, None
    if not isinstance(raw, dict) or raw.get("available") is not True:
        return None, None
    observed = parse_ts(raw.get("observedAt"))
    if observed is None or abs(now - observed) > PROJECTION_MAX_AGE:
        return None, None
    latest, usage = raw.get("latest"), raw.get("usage")
    session = None
    if isinstance(latest, dict):
        session = SessionView(
            started_at=parse_ts(latest.get("startedAt")),
            ended_at=parse_ts(latest.get("endedAt")),
            last_activity_at=parse_ts(latest.get("lastActivityAt")),
            description=clean_text(latest.get("description"), 160),
            model=clean_text(latest.get("model"), 60),
        )
    counters = None
    if isinstance(usage, dict):
        values = [usage.get(k) for k in _USAGE_KEYS]
        if all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in values):
            counters = UsageToday(*values)
    return session, counters


def read_projected_unit_states(home: Path) -> dict[str, str]:
    try:
        states = json.loads((home / "unit_states.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        log.warning("projected service states unavailable: %s", type(exc).__name__)
        return {}
    if not isinstance(states, dict):
        log.warning("invalid projected service states")
        return {}
    return {name: state for name, state in states.items() if isinstance(state, str)}


def _agent(
    agent: AgentConfig,
    config: Config,
    now: datetime,
    midnight: datetime,
    gateway: GatewayView | None,
    unit_states: dict[str, str],
) -> Json:
    src = agent.source
    if isinstance(src, SystemdSource):
        verdict = systemd_status({u: unit_states.get(u, "unknown") for u in src.units})
        return _base(agent, verdict)

    assert isinstance(src, HermesSource)
    s = config.settings
    home = profile_home(s.hermes_home, src.profile)
    if not s.read_session_state:
        # Isolated mode: session facts, if any, come from the projection (sessions/<id>.json).
        session, usage = read_projected_session(s.hermes_home, agent.id, now)
        verdict = hermes_status(
            now,
            gateway,
            src.platform,
            session,
            working_window=timedelta(seconds=s.working_window_seconds),
            gateway_stale_after=timedelta(seconds=s.gateway_stale_seconds),
        )
        out = _base(agent, verdict)
        out["lastActivityAt"] = iso(session.last_activity_at) if session else None
        out["model"] = session.model if session else None
        out["usageToday"] = usage.to_json() if usage else None
        out["cron"] = read_cron_jobs(home)
        return out

    db = StateDb(home / "state.db", s.work_dir)
    if not db.path.is_file():
        return _base(agent, Verdict("offline", reason=reason("state_db_missing")))

    try:
        session = db.latest_session(src.exclude_sources)
        usage = db.usage_since(midnight)
    except sqlite3.DatabaseError:
        # A copy taken mid-checkpoint can be torn; start over once.
        db.invalidate()
        session = db.latest_session(src.exclude_sources)
        usage = db.usage_since(midnight)
    verdict = hermes_status(
        now,
        gateway,
        src.platform,
        session,
        working_window=timedelta(seconds=s.working_window_seconds),
        gateway_stale_after=timedelta(seconds=s.gateway_stale_seconds),
    )
    out = _base(agent, verdict)
    out["lastActivityAt"] = iso(session.last_activity_at) if session else None
    out["model"] = session.model if session else None
    out["usageToday"] = usage.to_json()
    out["cron"] = read_cron_jobs(home)
    return out


def _base(agent: AgentConfig, verdict: Verdict) -> Json:
    return {
        "id": agent.id,
        "name": agent.name,
        "role": agent.role,
        "room": agent.room,
        "kind": agent.kind,
        "status": verdict.status,
        "activity": verdict.activity,
        "lastActivityAt": None,
        "model": None,
        "usageToday": None,
        "cron": [],
        "summary": agent.summary,
        "chatUrl": agent.chat_url,
        # Agent's own numbers arrive with passports (office v2, stage 2).
        "counters": [],
        "hasPassport": False,
        "project": agent.project,
        "reason": verdict.reason.to_json() if verdict.reason else None,
    }


def _host(probe: SystemProbe, config: Config, unit_states: dict[str, str]) -> Json | None:
    metrics = probe.metrics()
    if metrics is None:
        return None
    return {
        "memUsedMb": metrics.mem_used_mb,
        "memTotalMb": metrics.mem_total_mb,
        "diskUsedPercent": metrics.disk_used_percent,
        "load1": metrics.load1,
        "services": [
            {"name": u, "active": unit_states.get(u) == "active"} for u in config.host_services
        ],
    }


def load_quota(path: Path) -> Json | None:
    """Read the optional quota file written by ``deploy/quota-probe.sh``; validate its shape."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    if not isinstance(raw, dict):
        return None
    observed = parse_ts(raw.get("observedAt"))
    provider = clean_text(raw.get("provider"), 40)
    windows_raw = raw.get("windows")
    if observed is None or provider is None or not isinstance(windows_raw, list):
        return None
    windows: list[Json] = []
    for w in windows_raw[:4]:
        if not isinstance(w, dict):
            continue
        name = clean_text(w.get("name"), 20)
        used = w.get("usedPercent")
        if name is None or isinstance(used, bool) or not isinstance(used, int | float):
            continue
        windows.append(
            {
                "name": name,
                "usedPercent": round(min(max(float(used), 0.0), 100.0), 1),
                "resetsAt": iso(parse_ts(w.get("resetsAt"))),
            }
        )
    return {"provider": provider, "windows": windows, "observedAt": iso(observed)}


def write_atomic(path: Path, data: Json) -> None:
    """Write JSON so readers never see a half-written file (rename is atomic on POSIX).

    Permissions are set on the open file descriptor, never by path: a path-based chmod
    could be redirected through a symlink swapped in by another user of the directory.
    Each writer (exporter, quota probe) also owns its own directory.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            if hasattr(os, "fchmod"):  # POSIX (and Windows on Python 3.13+)
                os.fchmod(fh.fileno(), 0o644)
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
