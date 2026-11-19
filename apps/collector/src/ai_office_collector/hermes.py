"""Read-only access to Hermes Agent state files (verified against Hermes v0.21.6).

Layout of ``hermes_home`` (the container's ``/opt/data``)::

    gateway_state.json                 gateway + per-platform connection state
    state.db                           sessions of the ``default`` profile (SQLite, WAL)
    cron/jobs.json                     scheduled jobs of the ``default`` profile
    profiles/<name>/state.db           same for named profiles
    profiles/<name>/cron/jobs.json

Nothing here writes to Hermes data. SQLite databases are opened with ``mode=ro``.
Only machine-written metadata is read: session titles, message bodies, prompts and
cron job prompts/scripts are never selected.

Why the private copy (``work_dir``): a read-only SQLite connection to a WAL-mode
database still needs to create/map the ``-shm`` file next to it. The exporter
deliberately has no write access there, so opening the original fails with
``SQLITE_READONLY_DIRECTORY``, and ``immutable=1`` would ignore recent writes that
still live in the WAL. Instead the exporter copies ``state.db`` (only when it
changed, i.e. after a checkpoint) and ``state.db-wal`` (when it changed) into its
own private tmpfs directory and reads the copy.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .sanitize import clean_text, unique_slug
from .status import GatewayView, SessionView
from .timeutil import iso, parse_ts

MAX_CRON_JOBS = 50


def profile_home(hermes_home: Path, profile: str) -> Path:
    return hermes_home if profile == "default" else hermes_home / "profiles" / profile


def read_gateway(hermes_home: Path) -> GatewayView | None:
    try:
        raw = json.loads((hermes_home / "gateway_state.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    if not isinstance(raw, dict):
        return None
    platforms: dict[str, str] = {}
    raw_platforms = raw.get("platforms")
    # Tolerate unexpected shapes (e.g. a list) from other Hermes versions: no platforms.
    if isinstance(raw_platforms, dict):
        for key, value in raw_platforms.items():
            if isinstance(value, dict) and isinstance(value.get("state"), str):
                platforms[str(key)] = value["state"]
    return GatewayView(
        running=raw.get("gateway_state") == "running",
        updated_at=parse_ts(raw.get("updated_at")),
        platforms=platforms,
    )


@dataclass(frozen=True)
class UsageToday:
    api_calls: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int

    def to_json(self) -> dict[str, int]:
        return {
            "apiCalls": self.api_calls,
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "cacheReadTokens": self.cache_read_tokens,
        }


_SESSION_COLUMNS = (
    "source",
    "started_at",
    "ended_at",
    "last_activity_at",
    "last_activity_description",
    "model",
    "archived",
)


class StateDb:
    """Read-only view of one profile's ``state.db``.

    With ``work_dir`` set, queries run against a private copy (see module docstring).
    Without it the original is opened directly, which only works where the process
    may create the ``-shm`` file (tests, local development).
    """

    def __init__(self, path: Path, work_dir: Path | None = None) -> None:
        self.path = path
        self.work_dir = work_dir

    def _connect(self) -> sqlite3.Connection:
        if not self.path.is_file():
            raise FileNotFoundError(self.path)
        target = self._sync_copy() if self.work_dir else self.path
        # as_uri() needs an absolute path; config paths are absolute already, this is a guard.
        uri = f"{target.absolute().as_uri()}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=2.0)
        conn.execute("PRAGMA query_only = ON")
        return conn

    def _sync_copy(self) -> Path:
        assert self.work_dir is not None
        key = hashlib.sha256(str(self.path).encode()).hexdigest()[:16]
        # Copies contain private data: keep them owner-only, even inside a 0755 parent.
        self.work_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        folder = self.work_dir / key
        folder.mkdir(mode=0o700, exist_ok=True)
        dst = folder / "state.db"
        changed = False
        for suffix in ("", "-wal"):
            src_file = Path(f"{self.path}{suffix}")
            dst_file = Path(f"{dst}{suffix}")
            stamp_file = Path(f"{dst}{suffix}.stamp")
            try:
                st = src_file.stat()
            except FileNotFoundError:
                if dst_file.exists():
                    dst_file.unlink()
                    stamp_file.unlink(missing_ok=True)
                    changed = True
                continue
            stamp = f"{st.st_mtime_ns}:{st.st_size}"
            if dst_file.exists() and _read(stamp_file) == stamp:
                continue
            tmp = Path(f"{dst_file}.tmp")
            shutil.copyfile(src_file, tmp)
            os.replace(tmp, dst_file)
            stamp_file.write_text(stamp)
            changed = True
        if changed:
            # The wal-index is rebuilt from the WAL on the next open.
            Path(f"{dst}-shm").unlink(missing_ok=True)
        return dst

    def invalidate(self) -> None:
        """Drop the private copy, e.g. after reading a torn copy."""
        if self.work_dir is not None:
            key = hashlib.sha256(str(self.path).encode()).hexdigest()[:16]
            shutil.rmtree(self.work_dir / key, ignore_errors=True)

    def latest_session(self, exclude_sources: tuple[str, ...] = ()) -> SessionView | None:
        with closing(self._connect()) as conn:
            existing = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
            cols = [c if c in existing else f"NULL AS {c}" for c in _SESSION_COLUMNS]
            order = (
                "COALESCE(last_activity_at, started_at)"
                if "last_activity_at" in existing
                else "started_at"
            )
            where = ["COALESCE(archived, 0) = 0"] if "archived" in existing else []
            if exclude_sources and "source" in existing:
                marks = ", ".join("?" for _ in exclude_sources)
                where.append(f"COALESCE(source, '') NOT IN ({marks})")
            clause = f"WHERE {' AND '.join(where)}" if where else ""
            # Only constant column names are interpolated; values are bound parameters.
            rows = conn.execute(
                f"SELECT {', '.join(cols)} FROM sessions {clause} ORDER BY {order} DESC LIMIT 1",
                exclude_sources if "source" in existing else (),
            ).fetchall()
        for _source, started, ended, last_at, desc, model, _archived in rows:
            return SessionView(
                started_at=parse_ts(started),
                ended_at=parse_ts(ended),
                last_activity_at=parse_ts(last_at) or parse_ts(started),
                description=desc if isinstance(desc, str) else None,
                model=clean_text(model, 60),
            )
        return None

    def usage_since(self, since: datetime) -> UsageToday:
        """Sum usage rows last seen after ``since``.

        Approximation: ``session_model_usage`` aggregates per session and model, so a
        session that started before midnight is counted entirely in today's numbers.
        """
        totals = [0, 0, 0, 0]
        with closing(self._connect()) as conn:
            existing = {row[1] for row in conn.execute("PRAGMA table_info(session_model_usage)")}
            if not existing:
                return UsageToday(0, 0, 0, 0)
            wanted = (
                "last_seen",
                "api_call_count",
                "input_tokens",
                "output_tokens",
                "cache_read_tokens",
            )
            cols = [c if c in existing else f"NULL AS {c}" for c in wanted]
            for row in conn.execute(f"SELECT {', '.join(cols)} FROM session_model_usage"):
                seen = parse_ts(row[0])
                if seen is None or seen < since:
                    continue
                for i, value in enumerate(row[1:]):
                    if isinstance(value, int | float) and value > 0:
                        totals[i] += int(value)
        return UsageToday(*totals)


_STATUS_MAP = {
    "ok": "ok",
    "success": "ok",
    "succeeded": "ok",
    "completed": "ok",
    "error": "error",
    "failed": "error",
    "failure": "error",
    "timeout": "error",
}


def read_cron_jobs(home: Path) -> list[dict[str, Any]]:
    """Return jobs in the protocol ``CronJob`` shape. Prompts/scripts are never read out."""
    try:
        raw = json.loads((home / "cron" / "jobs.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except (json.JSONDecodeError, OSError):
        return []
    jobs = raw.get("jobs", []) if isinstance(raw, dict) else raw
    if not isinstance(jobs, list):
        return []

    result: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for job in jobs[:MAX_CRON_JOBS]:
        if not isinstance(job, dict):
            continue
        name = clean_text(job.get("name"), 80) or "unnamed job"
        job_id = unique_slug(str(job.get("id") or job.get("name") or "job"), used_ids)

        last_raw = job.get("last_status")
        last_status = (
            None if last_raw in (None, "") else _STATUS_MAP.get(str(last_raw).lower(), "unknown")
        )
        state = str(job.get("state") or "").lower()
        result.append(
            {
                "id": job_id,
                "name": name,
                "schedule": _schedule_text(job.get("schedule") or job.get("schedule_display")),
                "enabled": bool(job.get("enabled", True)) and state not in ("paused", "disabled"),
                "nextRunAt": iso(parse_ts(job.get("next_run_at"))),
                "lastRunAt": iso(parse_ts(job.get("last_run_at"))),
                "lastStatus": last_status,
            }
        )
    return result


def _read(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None


def _schedule_text(schedule: object) -> str:
    if isinstance(schedule, dict):
        value = schedule.get("display") or schedule.get("expr") or schedule.get("kind")
    else:
        value = schedule
    return clean_text(value, 80) or ""
