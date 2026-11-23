from __future__ import annotations

from datetime import timedelta

import pytest

from ai_office_collector.protocol import REASON_CODES, REASON_PARAM_MAX
from ai_office_collector.sanitize import utf16_len
from ai_office_collector.status import (
    GatewayView,
    Reason,
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
    # (name, gateway, platform, session, expected status, expected activity, expected reason)
    ("no gateway file", None, "telegram", session(), "offline", None, Reason("gateway_missing")),
    (
        "gateway stopped",
        GatewayView(False, NOW, {"telegram": "connected"}),
        "telegram",
        session(),
        "offline",
        None,
        Reason("gateway_stopped"),
    ),
    (
        "gateway stale",
        GatewayView(True, NOW - minutes(4), {"telegram": "connected"}),
        "telegram",
        session(),
        "offline",
        None,
        Reason("gateway_stale"),
    ),
    (
        "telegram retrying",
        GatewayView(True, NOW, {"telegram": "retrying"}),
        "telegram",
        session(),
        "error",
        None,
        Reason("platform_down", {"platform": "Telegram", "state": "retrying"}),
    ),
    (
        "profile platform missing",
        OK_GATEWAY,
        "hunter:telegram",
        session(),
        "error",
        None,
        Reason("platform_missing", {"platform": "Telegram"}),
    ),
    ("platform check disabled", OK_GATEWAY, None, None, "idle", None, None),
    ("open + recent -> working", OK_GATEWAY, "telegram", session(), "working", "web_search", None),
    (
        "no description -> no activity line, never the session title",
        OK_GATEWAY,
        "telegram",
        session(desc=None),
        "working",
        None,
        None,
    ),
    ("open but quiet -> idle", OK_GATEWAY, "telegram", session(active_ago=5), "idle", None, None),
    ("closed session -> idle", OK_GATEWAY, "telegram", session(open_=False), "idle", None, None),
    (
        "no activity ts -> idle",
        OK_GATEWAY,
        "telegram",
        session(active_ago=None),
        "idle",
        None,
        None,
    ),
    ("no sessions -> idle", OK_GATEWAY, "telegram", None, "idle", None, None),
]


@pytest.mark.parametrize(
    ("gateway", "platform", "sess", "status", "activity", "reason"),
    [c[1:] for c in CASES],
    ids=[c[0] for c in CASES],
)
def test_hermes_status(gateway, platform, sess, status, activity, reason):
    verdict = hermes_status(
        NOW,
        gateway,
        platform,
        sess,
        working_window=timedelta(seconds=120),
        gateway_stale_after=timedelta(seconds=180),
    )
    assert (verdict.status, verdict.activity, verdict.reason) == (status, activity, reason)


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
    ("states", "status", "reason"),
    [
        ({"a.service": "active", "b.service": "active"}, "idle", None),
        (
            {"a.service": "active", "b.service": "inactive"},
            "offline",
            Reason("unit_down", {"unit": "b", "state": "inactive"}),
        ),
        (
            {"a.service": "inactive", "b.service": "failed"},
            "error",
            Reason("unit_failed", {"unit": "b"}),
        ),
        (
            {"bot@prod.service": "activating"},
            "offline",
            Reason("unit_down", {"unit": "bot@prod", "state": "activating"}),
        ),
        ({}, "offline", Reason("no_units")),
    ],
)
def test_systemd_status(states, status, reason):
    verdict = systemd_status(states)
    assert (verdict.status, verdict.activity, verdict.reason) == (status, None, reason)


def test_every_reason_code_is_in_the_protocol():
    produced = {c[6].code for c in CASES if c[6] is not None} | {
        "unit_failed",
        "unit_down",
        "no_units",
    }
    assert produced <= set(REASON_CODES)


def test_reason_params_fit_the_protocol_limit_in_utf16_units():
    unit = "my.bot." * 10 + "\U0001f642" * 20 + ".service"
    verdict = systemd_status({unit: "failed"})
    assert verdict.reason is not None
    value = verdict.reason.params["unit"]
    assert utf16_len(value) <= REASON_PARAM_MAX
    assert value.endswith("…")
    assert verdict.reason.to_json() == {"code": "unit_failed", "params": {"unit": value}}
