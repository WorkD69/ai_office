"""Collector configuration (TOML). See ``config.example.toml``."""

from __future__ import annotations

import os
import re
import tomllib
from dataclasses import dataclass, field
from datetime import UTC, tzinfo
from pathlib import Path, PurePosixPath
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

AGENT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
ROOM_RE = re.compile(r"^[a-z0-9-]{1,32}$")
PROFILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
UNIT_RE = re.compile(r"^[A-Za-z0-9@._:-]{1,120}\.(service|timer|socket|target)$")
#: Protocol limit for ``Host.services[].name``.
HOST_SERVICE_NAME_MAX = 80

Kind = Literal["llm", "worker", "dev"]


class ConfigError(ValueError):
    """Raised with a human-readable message when the config file is invalid."""


@dataclass(frozen=True)
class HermesSource:
    profile: str
    #: gateway_state.json platform key; ``None`` disables the gateway check.
    platform: str | None
    #: Session sources ignored when deciding what the agent is doing
    #: (e.g. ``tool`` sessions opened by another service through a broker).
    exclude_sources: tuple[str, ...] = ()


@dataclass(frozen=True)
class SystemdSource:
    units: tuple[str, ...]


@dataclass(frozen=True)
class AgentConfig:
    id: str
    name: str
    role: str
    room: str
    kind: Kind
    source: HermesSource | SystemdSource


@dataclass(frozen=True)
class Settings:
    hermes_home: Path
    output: Path
    quota_file: Path | None
    #: Private scratch dir for SQLite copies (must NOT be readable by the relay).
    work_dir: Path | None = None
    interval_seconds: float = 5.0
    working_window_seconds: float = 120.0
    gateway_stale_seconds: float = 180.0
    timezone: str | None = None
    read_session_state: bool = True
    #: Isolated mode only: Hermes data dir the *projection* reads state.db from (it has no
    #: network and never writes there). The exporter then gets working status and usage
    #: from the projection instead of reading Hermes itself.
    session_source: Path | None = None


@dataclass(frozen=True)
class Config:
    settings: Settings
    agents: tuple[AgentConfig, ...]
    host_services: tuple[str, ...] = field(default_factory=tuple)

    def all_units(self) -> tuple[str, ...]:
        """Every systemd unit we need to query, de-duplicated, order preserved."""
        units: list[str] = []
        for agent in self.agents:
            if isinstance(agent.source, SystemdSource):
                units.extend(agent.source.units)
        units.extend(self.host_services)
        return tuple(dict.fromkeys(units))


def load_config(path: Path) -> Config:
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"config file not found: {path}") from exc
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"invalid TOML in {path}: {exc}") from exc
    return parse_config(raw)


def parse_config(raw: dict[str, Any]) -> Config:
    col = _table(raw, "collector")
    timezone = col.get("timezone") or None
    if timezone is not None:
        if not isinstance(timezone, str):
            raise ConfigError("collector.timezone must be a string such as 'UTC'")
        try:
            resolve_timezone(timezone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ConfigError(
                f"collector.timezone: unknown time zone {timezone!r} "
                "(use an IANA name such as 'UTC' or 'Europe/Berlin'; install tzdata if missing)"
            ) from exc
    read_session_state = col.get("read_session_state", True)
    if not isinstance(read_session_state, bool):
        raise ConfigError("collector.read_session_state must be true or false")
    settings = Settings(
        hermes_home=_path(_str(col, "hermes_home", "collector")),
        output=_path(col.get("output", "/run/agent-office/snapshot.json")),
        quota_file=_path(col["quota_file"]) if col.get("quota_file") else None,
        work_dir=_path(col["work_dir"]) if col.get("work_dir") else None,
        interval_seconds=_positive(col, "interval_seconds", 5.0),
        working_window_seconds=_positive(col, "working_window_seconds", 120.0),
        gateway_stale_seconds=_positive(col, "gateway_stale_seconds", 180.0),
        timezone=timezone,
        read_session_state=read_session_state,
        session_source=_path(col["session_source"]) if col.get("session_source") else None,
    )

    agents_raw = raw.get("agents")
    if not isinstance(agents_raw, list) or not agents_raw:
        raise ConfigError("at least one [[agents]] entry is required")
    if len(agents_raw) > 64:
        raise ConfigError("at most 64 agents are supported")

    agents: list[AgentConfig] = []
    seen: set[str] = set()
    for i, item in enumerate(agents_raw):
        where = f"agents[{i}]"
        if not isinstance(item, dict):
            raise ConfigError(f"{where} must be a table")
        agent = _parse_agent(item, where)
        if agent.id in seen:
            raise ConfigError(f"{where}: duplicate agent id {agent.id!r}")
        seen.add(agent.id)
        agents.append(agent)

    host = raw.get("host", {})
    if not isinstance(host, dict):
        raise ConfigError("[host] must be a table")
    services = tuple(_unit(u, "host.services") for u in host.get("services", []))
    for unit in services:
        if len(unit) > HOST_SERVICE_NAME_MAX:
            raise ConfigError(
                f"host.services: {unit!r} is longer than {HOST_SERVICE_NAME_MAX} characters"
            )
    if len(services) > 40:
        raise ConfigError("host.services supports at most 40 units")
    return Config(settings=settings, agents=tuple(agents), host_services=services)


def _parse_agent(item: dict[str, Any], where: str) -> AgentConfig:
    agent_id = _str(item, "id", where)
    if not AGENT_ID_RE.match(agent_id):
        raise ConfigError(f"{where}.id must match {AGENT_ID_RE.pattern}")
    room = _str(item, "room", where)
    if not ROOM_RE.match(room):
        raise ConfigError(f"{where}.room must match {ROOM_RE.pattern}")
    name = _str(item, "name", where)
    if len(name) > 40:
        raise ConfigError(f"{where}.name is longer than 40 characters")
    role = str(item.get("role", ""))
    if len(role) > 80:
        raise ConfigError(f"{where}.role is longer than 80 characters")
    kind = item.get("kind", "llm")
    if kind not in ("llm", "worker", "dev"):
        raise ConfigError(f"{where}.kind must be one of llm, worker, dev")

    source_type = item.get("source")
    source: HermesSource | SystemdSource
    if source_type == "hermes":
        profile = str(item.get("profile", "default"))
        if not PROFILE_RE.match(profile):
            raise ConfigError(f"{where}.profile has invalid characters")
        default_platform = "telegram" if profile == "default" else f"{profile}:telegram"
        platform = item.get("platform", default_platform)
        if platform is not None and not isinstance(platform, str):
            raise ConfigError(f"{where}.platform must be a string")
        excluded = item.get("exclude_sources", [])
        if not isinstance(excluded, list) or not all(isinstance(s, str) for s in excluded):
            raise ConfigError(f"{where}.exclude_sources must be a list of strings")
        source = HermesSource(profile, platform or None, tuple(excluded))
    elif source_type == "systemd":
        units = item.get("units")
        if not isinstance(units, list) or not units:
            raise ConfigError(f"{where}.units must be a non-empty list")
        source = SystemdSource(tuple(_unit(u, f"{where}.units") for u in units))
    else:
        raise ConfigError(f"{where}.source must be 'hermes' or 'systemd'")

    return AgentConfig(id=agent_id, name=name, role=role, room=room, kind=kind, source=source)


def resolve_timezone(name: str | None) -> tzinfo | None:
    """IANA zone for ``name``; ``None`` means system local time.

    ``UTC`` is handled without the tz database so it works everywhere (e.g. Windows
    development machines without the ``tzdata`` package).
    """
    if name is None:
        return None
    if name.upper() in ("UTC", "ETC/UTC", "Z"):
        return UTC
    return ZoneInfo(name)


def _path(value: object) -> Path:
    """Absolute path. Relative paths are resolved against the working directory."""
    text = str(value)
    if PurePosixPath(text).is_absolute() or Path(text).is_absolute():
        return Path(text)
    return Path(os.path.abspath(text))


def _table(raw: dict[str, Any], key: str) -> dict[str, Any]:
    value = raw.get(key)
    if not isinstance(value, dict):
        raise ConfigError(f"[{key}] table is required")
    return value


def _str(table: dict[str, Any], key: str, where: str) -> str:
    value = table.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{where}.{key} must be a non-empty string")
    return value.strip()


def _positive(table: dict[str, Any], key: str, default: float) -> float:
    value = table.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
        raise ConfigError(f"collector.{key} must be a positive number")
    return float(value)


def _unit(value: object, where: str) -> str:
    # Unit names end up in a fixed argv for `systemctl is-active`; never in a shell.
    if not isinstance(value, str) or not UNIT_RE.match(value):
        raise ConfigError(f"{where}: invalid systemd unit name {value!r}")
    return value
