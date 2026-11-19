"""Pure status rules. Everything here is deterministic and unit-tested."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from .sanitize import clean_text

Status = Literal["working", "waiting_you", "waiting_external", "error", "idle", "offline"]

ACTIVITY_LIMIT = 160
#: Shown when a session is active but Hermes recorded no activity description.
IN_CONVERSATION = "In a conversation"


@dataclass(frozen=True)
class GatewayView:
    """The parts of ``gateway_state.json`` the rules need."""

    running: bool
    updated_at: datetime | None
    platforms: dict[str, str]


@dataclass(frozen=True)
class SessionView:
    """The most recent relevant session of a Hermes profile."""

    started_at: datetime | None
    ended_at: datetime | None
    last_activity_at: datetime | None
    #: Hermes' short machine-written ``last_activity_description`` (e.g. "calling web_search").
    #: Session titles are deliberately not read: they can paraphrase the conversation.
    description: str | None
    model: str | None


@dataclass(frozen=True)
class Verdict:
    status: Status
    activity: str | None


def hermes_status(
    now: datetime,
    gateway: GatewayView | None,
    platform: str | None,
    session: SessionView | None,
    *,
    working_window: timedelta,
    gateway_stale_after: timedelta,
) -> Verdict:
    """Status of a Hermes profile, first matching rule wins.

    1. gateway state missing, not ``running`` or older than ``gateway_stale_after`` -> offline
    2. the profile's messaging platform is not ``connected`` -> error
    3. latest session still open and active within ``working_window`` -> working
       (activity = sanitised ``last_activity_description`` or a neutral phrase)
    4. otherwise -> idle
    """
    if gateway is None:
        return Verdict("offline", "Hermes gateway state not found")
    if not gateway.running:
        return Verdict("offline", "Hermes gateway is not running")
    if gateway.updated_at is None or now - gateway.updated_at > gateway_stale_after:
        return Verdict("offline", "Hermes gateway heartbeat is stale")

    if platform is not None:
        state = gateway.platforms.get(platform)
        if state != "connected":
            label = platform.split(":")[-1].capitalize()
            return Verdict("error", clean_text(f"{label} gateway: {state or 'missing'}", 160))

    if (
        session is not None
        and session.ended_at is None
        and session.last_activity_at is not None
        and now - session.last_activity_at <= working_window
    ):
        activity = clean_text(session.description, ACTIVITY_LIMIT)
        return Verdict("working", activity or IN_CONVERSATION)

    return Verdict("idle", None)


def systemd_status(states: dict[str, str]) -> Verdict:
    """Combine ``systemctl is-active`` states of an agent's units; the worst one wins.

    ``active`` -> idle, ``failed`` -> error, anything else (inactive, activating,
    unknown, ...) -> offline. A running bot is shown as idle rather than working
    because "the process is alive" says nothing about whether it is doing work.
    """
    if not states:
        return Verdict("offline", "no units configured")
    failed = [u for u, s in states.items() if s == "failed"]
    if failed:
        return Verdict("error", clean_text(f"{_short(failed[0])} failed", ACTIVITY_LIMIT))
    down = [(u, s) for u, s in states.items() if s != "active"]
    if down:
        unit, state = down[0]
        return Verdict("offline", clean_text(f"{_short(unit)}: {state}", ACTIVITY_LIMIT))
    return Verdict("idle", None)


def _short(unit: str) -> str:
    return unit.removesuffix(".service")
