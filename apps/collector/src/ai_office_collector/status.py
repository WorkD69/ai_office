"""Pure status rules. Everything here is deterministic and unit-tested."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal

from .protocol import REASON_CODES, REASON_PARAM_MAX
from .sanitize import clean_text

Status = Literal["working", "waiting_you", "waiting_external", "error", "idle", "offline"]

ACTIVITY_LIMIT = 160


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
class Reason:
    """The collector's own reason for a status, as a code the web app translates.

    Codes are listed in ``protocol.REASON_CODES``; params are short names (unit, platform,
    state), never free text from Hermes. Build it with :func:`reason` so params are clean.
    """

    code: str
    params: dict[str, str] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {"code": self.code, "params": dict(self.params)}


def reason(code: str, **params: object) -> Reason:
    """A :class:`Reason` with params sanitised and clamped to ``REASON_PARAM_MAX`` UTF-16 units."""
    if code not in REASON_CODES:
        raise ValueError(f"unknown reason code {code!r}")
    return Reason(code, {k: clean_text(v, REASON_PARAM_MAX) or "?" for k, v in params.items()})


@dataclass(frozen=True)
class Verdict:
    status: Status
    #: Hermes' own activity description (free text, shown as is); never the collector's words.
    activity: str | None = None
    reason: Reason | None = None


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
       (activity = sanitised ``last_activity_description``, else none)
    4. otherwise -> idle
    """
    if gateway is None:
        return Verdict("offline", reason=reason("gateway_missing"))
    if not gateway.running:
        return Verdict("offline", reason=reason("gateway_stopped"))
    if gateway.updated_at is None or now - gateway.updated_at > gateway_stale_after:
        return Verdict("offline", reason=reason("gateway_stale"))

    if platform is not None:
        state = gateway.platforms.get(platform)
        if state != "connected":
            label = platform.split(":")[-1].capitalize()
            if not state:
                return Verdict("error", reason=reason("platform_missing", platform=label))
            return Verdict("error", reason=reason("platform_down", platform=label, state=state))

    if (
        session is not None
        and session.ended_at is None
        and session.last_activity_at is not None
        and now - session.last_activity_at <= working_window
    ):
        return Verdict("working", clean_text(session.description, ACTIVITY_LIMIT))

    return Verdict("idle", None)


def systemd_status(states: dict[str, str]) -> Verdict:
    """Combine ``systemctl is-active`` states of an agent's units; the worst one wins.

    ``active`` -> idle, ``failed`` -> error, anything else (inactive, activating,
    unknown, ...) -> offline. A running bot is shown as idle rather than working
    because "the process is alive" says nothing about whether it is doing work.
    """
    if not states:
        return Verdict("offline", reason=reason("no_units"))
    failed = [u for u, s in states.items() if s == "failed"]
    if failed:
        return Verdict("error", reason=reason("unit_failed", unit=_short(failed[0])))
    down = [(u, s) for u, s in states.items() if s != "active"]
    if down:
        unit, state = down[0]
        return Verdict("offline", reason=reason("unit_down", unit=_short(unit), state=state))
    return Verdict("idle", None)


def _short(unit: str) -> str:
    return unit.removesuffix(".service")
