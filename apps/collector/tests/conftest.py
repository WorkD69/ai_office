"""Synthetic Hermes home used by the tests. No real data from any server."""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from ai_office_collector.config import parse_config
from ai_office_collector.host import HostMetrics

NOW = datetime(2026, 11, 19, 12, 0, 0, tzinfo=UTC)

# Column names as found in Hermes v0.21.6 state.db (schema v31).
SESSION_COLUMNS = [
    "id",
    "source",
    "created_source",
    "user_id",
    "session_key",
    "chat_id",
    "chat_type",
    "thread_id",
    "display_name",
    "origin_json",
    "expiry_finalized",
    "model",
    "model_config",
    "system_prompt",
    "system_prompt_hash",
    "parent_session_id",
    "started_at",
    "ended_at",
    "end_reason",
    "message_count",
    "tool_call_count",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "cwd",
    "git_branch",
    "git_repo_root",
    "git_metadata_generation",
    "billing_provider",
    "billing_base_url",
    "billing_mode",
    "estimated_cost_usd",
    "actual_cost_usd",
    "cost_status",
    "cost_source",
    "pricing_version",
    "title",
    "title_source",
    "last_activity_at",
    "last_activity_description",
    "last_activity_provenance",
    "api_call_count",
    "handoff_state",
    "handoff_platform",
    "handoff_error",
    "compression_failure_cooldown_until",
    "compression_failure_error",
    "compression_fallback_streak",
    "compression_ineffective_count",
    "compression_recovery_deadline",
    "compression_overload_streak",
    "profile_name",
    "transport_profile",
    "rewind_count",
    "archived",
    "auto_archived",
    "pinned",
    "hidden",
    "last_read_at",
    "tool_names",
]

USAGE_COLUMNS = [
    "session_id",
    "model",
    "billing_provider",
    "billing_base_url",
    "billing_mode",
    "task",
    "api_call_count",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "estimated_cost_usd",
    "actual_cost_usd",
    "cost_status",
    "cost_source",
    "first_seen",
    "last_seen",
]


def ts(dt: datetime) -> float:
    return dt.timestamp()


@dataclass
class FakeHermes:
    home: Path

    def profile_dir(self, profile: str) -> Path:
        p = self.home if profile == "default" else self.home / "profiles" / profile
        p.mkdir(parents=True, exist_ok=True)
        return p

    def gateway(
        self,
        *,
        running: bool = True,
        updated_at: datetime = NOW,
        platforms: dict[str, str] | None = None,
    ) -> None:
        platforms = platforms or {"telegram": "connected", "hunter:telegram": "connected"}
        data = {
            "gateway_state": "running" if running else "stopped",
            "updated_at": updated_at.isoformat(),
            "platforms": {k: {"state": v, "error_code": None} for k, v in platforms.items()},
            "served_profiles": ["default", "hunter"],
            "active_agents": 0,
        }
        (self.home / "gateway_state.json").write_text(json.dumps(data), encoding="utf-8")

    def db(self, profile: str) -> sqlite3.Connection:
        path = self.profile_dir(profile) / "state.db"
        conn = sqlite3.connect(path)
        conn.execute(f"CREATE TABLE IF NOT EXISTS sessions ({', '.join(SESSION_COLUMNS)})")
        conn.execute(f"CREATE TABLE IF NOT EXISTS session_model_usage ({', '.join(USAGE_COLUMNS)})")
        return conn

    def session(self, profile: str, **values: Any) -> None:
        row = {"id": uuid.uuid4().hex, "source": "telegram", **values}
        with self.db(profile) as conn:
            cols = ", ".join(row)
            marks = ", ".join("?" for _ in row)
            conn.execute(f"INSERT INTO sessions ({cols}) VALUES ({marks})", list(row.values()))
        conn.close()

    def usage(self, profile: str, **values: Any) -> None:
        row = {"session_id": "s", "model": "gpt-6-luna", **values}
        with self.db(profile) as conn:
            cols = ", ".join(row)
            marks = ", ".join("?" for _ in row)
            conn.execute(
                f"INSERT INTO session_model_usage ({cols}) VALUES ({marks})", list(row.values())
            )
        conn.close()

    def jobs(self, profile: str, jobs: list[dict[str, Any]]) -> None:
        cron = self.profile_dir(profile) / "cron"
        cron.mkdir(parents=True, exist_ok=True)
        (cron / "jobs.json").write_text(json.dumps({"jobs": jobs}), encoding="utf-8")


@pytest.fixture
def hermes(tmp_path: Path) -> FakeHermes:
    home = tmp_path / "hermes"
    home.mkdir()
    return FakeHermes(home)


class FakeProbe:
    def __init__(self, states: dict[str, str] | None = None) -> None:
        self.states = states or {}

    def unit_states(self, units: tuple[str, ...]) -> dict[str, str]:
        return {u: self.states.get(u, "active") for u in units}

    def metrics(self) -> HostMetrics | None:
        return HostMetrics(
            mem_used_mb=1060.0, mem_total_mb=1967.0, disk_used_percent=73.0, load1=0.07
        )


def make_config(home: Path, tmp_path: Path, **collector: Any):
    raw = {
        "collector": {
            "hermes_home": str(home),
            "output": str(tmp_path / "out" / "snapshot.json"),
            "quota_file": str(tmp_path / "quota.json"),
            **collector,
        },
        "agents": [
            {
                "id": "coordinator",
                "name": "Coordinator",
                "role": "Main assistant",
                "room": "hq",
                "kind": "llm",
                "source": "hermes",
                "profile": "default",
                "exclude_sources": ["tool"],
            },
            {
                "id": "hunter",
                "name": "Hunter",
                "role": "Finds opportunities",
                "room": "opportunities",
                "kind": "llm",
                "source": "hermes",
                "profile": "hunter",
                "summary": "Looks for internships, once a day",
                "chat_url": "https://t.me/example_hunter_bot",
                "project": "example-hunter",
            },
            {
                "id": "signals",
                "name": "Signals",
                "role": "Trading signals",
                "room": "trading",
                "kind": "worker",
                "source": "systemd",
                "units": ["signals.service", "broker.service"],
            },
        ],
        "host": {"services": ["docker.service"]},
    }
    return parse_config(raw)


def minutes(n: float) -> timedelta:
    return timedelta(minutes=n)
