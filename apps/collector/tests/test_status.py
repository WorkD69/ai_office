from __future__ import annotations

from datetime import timedelta

import pytest

from ai_office_collector.status import (
    GatewayView,
    SessionView,
    hermes_status,
    systemd_status,
)
from conftest import NOW, minutes

OK_GATEWAY = GatewayView(running=True, updated_at=NOW, platforms={"telegram": "connected"})


def session(*, open_: bool = True, active_ago: float | None = 0.5, desc: str | None = "web_search"):
    return SessionView(
        started_at=NOW - minutes(10),
        ended_at=None if open_ else NOW - minutes(1),
        last_activity_at=None if active_ago is None else NOW - minutes(active_ago),
        description=desc,
        model="gpt-6-luna",
    )


CASES = [
    # (name, gateway, platform, session, expected status, expected activity)
    ("no gateway file", None, "telegram", session(), "offline", "Hermes gateway state not found"),
    (
        "gateway stopped",
        GatewayView(False, NOW, {"telegram": "connected"}),
        "telegram",
        session(),
        "offline",
        "Hermes gateway is not running",
    ),
    (
        "gateway stale",
        GatewayView(True, NOW - minutes(4), {"telegram": "connected"}),
        "telegram",
        session(),
        "offline",
        "Hermes gateway heartbeat is stale",
    ),
    (
        "telegram retrying",
        GatewayView(True, NOW, {"telegram": "retrying"}),
        "telegram",
        session(),
        "error",
        "Telegram gateway: retrying",
    ),
    (
        "profile platform missing",
        OK_GATEWAY,
        "hunter:telegram",
        session(),
        "error",
        "Telegram gateway: missing",
    ),
    ("platform check disabled", OK_GATEWAY, None, None, "idle", None),
    ("open + recent -> working", OK_GATEWAY, "telegram", session(), "working", "web_search"),
    (
        "no description -> neutral phrase, never the session title",
        OK_GATEWAY,
        "telegram",
        session(desc=None),
        "working",
        "In a conversation",
    ),
    ("open but quiet -> idle", OK_GATEWAY, "telegram", session(active_ago=5), "idle", None),
    ("closed session -> idle", OK_GATEWAY, "telegram", session(open_=False), "idle", None),
    ("no activity ts -> idle", OK_GATEWAY, "telegram", session(active_ago=None), "idle", None),
    ("no sessions -> idle", OK_GATEWAY, "telegram", None, "idle", None),
]


@pytest.mark.parametrize(
    ("gateway", "platform", "sess", "status", "activity"),
    [c[1:] for c in CASES],
    ids=[c[0] for c in CASES],
)
def test_hermes_status(gateway, platform, sess, status, activity):
    verdict = hermes_status(
        NOW,
        gateway,
        platform,
        sess,
        working_window=timedelta(seconds=120),
        gateway_stale_after=timedelta(seconds=180),
    )
    assert (verdict.status, verdict.activity) == (status, activity)


def test_working_activity_is_sanitised():
    verdict = hermes_status(
        NOW,
        OK_GATEWAY,
        "telegram",
        session(desc="calling api with token=abc123\n\x07 now"),
        working_window=timedelta(seconds=120),
        gateway_stale_after=timedelta(seconds=180),
    )
    assert verdict.activity == "calling api with [redacted] now"


@pytest.mark.parametrize(
    ("states", "status", "activity"),
    [
        ({"a.service": "active", "b.service": "active"}, "idle", None),
        ({"a.service": "active", "b.service": "inactive"}, "offline", "b: inactive"),
        ({"a.service": "inactive", "b.service": "failed"}, "error", "b failed"),
        ({"bot@prod.service": "activating"}, "offline", "bot@prod: activating"),
        ({}, "offline", "no units configured"),
    ],
)
def test_systemd_status(states, status, activity):
    verdict = systemd_status(states)
    assert (verdict.status, verdict.activity) == (status, activity)
