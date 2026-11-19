from __future__ import annotations

import itertools
import json
import uuid

import pytest

from ai_office_collector.relay import (
    SendPolicy,
    backoff_delays,
    fingerprint,
    handle_incoming,
    heartbeat_message,
    read_snapshot,
    snapshot_message,
    validate_url,
)

SNAP = {
    "v": 1,
    "generatedAt": "2026-11-19T12:00:00.000Z",
    "agents": [],
    "quota": None,
    "host": None,
}


def test_fingerprint_ignores_generated_at():
    other = {**SNAP, "generatedAt": "2026-11-19T12:00:05.000Z"}
    assert fingerprint(SNAP) == fingerprint(other)
    assert fingerprint(SNAP) != fingerprint({**SNAP, "agents": [{"id": "x"}]})


def test_send_policy_sends_on_change_and_periodically():
    policy = SendPolicy(resend=60)
    assert policy.should_send(SNAP, now=0) is True
    assert policy.should_send({**SNAP, "generatedAt": "later"}, now=5) is False
    assert policy.should_send({**SNAP, "agents": [{"id": "x"}]}, now=6) is True
    assert policy.should_send({**SNAP, "agents": [{"id": "x"}]}, now=30) is False
    assert policy.should_send({**SNAP, "agents": [{"id": "x"}]}, now=66) is True
    policy.reset()
    assert policy.should_send({**SNAP, "agents": [{"id": "x"}]}, now=67) is True


def test_messages_match_protocol_shape():
    assert json.loads(snapshot_message(SNAP)) == {"type": "snapshot", "snapshot": SNAP}
    hb = json.loads(heartbeat_message())
    assert hb["type"] == "heartbeat" and hb["at"].endswith("Z")


def test_commands_are_always_rejected():
    cmd_id = str(uuid.uuid4())
    raw = json.dumps(
        {"type": "command", "command": {"id": cmd_id, "action": "cron.pause", "args": {}}}
    )
    reply = json.loads(handle_incoming(raw))
    assert reply == {
        "type": "command_result",
        "commandId": cmd_id,
        "ok": False,
        "detail": "commands are not enabled on this collector",
    }


@pytest.mark.parametrize(
    "raw",
    [
        b"binary",
        "not json",
        "[1,2]",
        json.dumps({"type": "hello"}),
        json.dumps({"type": "command", "command": {"id": "not-a-uuid", "action": "x"}}),
        "x" * (256 * 1024 + 1),
    ],
)
def test_other_messages_get_no_reply(raw):
    assert handle_incoming(raw) is None


def test_validate_url():
    assert validate_url("wss://office.example.workers.dev/api/collector", False)
    assert validate_url("ws://localhost:8787/api/collector", True)
    with pytest.raises(ValueError):
        validate_url("ws://localhost:8787/api/collector", False)
    with pytest.raises(ValueError):
        validate_url("http://example.com", True)


def test_backoff_is_bounded():
    delays = list(itertools.islice(backoff_delays(base=1, cap=10), 30))
    assert all(0 <= d <= 10 for d in delays)


def test_read_snapshot(tmp_path):
    p = tmp_path / "snapshot.json"
    assert read_snapshot(p) is None
    p.write_text(json.dumps({"v": 2}), encoding="utf-8")
    assert read_snapshot(p) is None
    p.write_text(json.dumps(SNAP), encoding="utf-8")
    assert read_snapshot(p) == SNAP


def test_fingerprint_buckets_volatile_host_metrics_and_ignores_quota_timestamp():
    def snap(mem, load, observed):
        return {
            **SNAP,
            "host": {
                "memUsedMb": mem,
                "memTotalMb": 2000,
                "diskUsedPercent": 73.2,
                "load1": load,
                "services": [],
            },
            "quota": {"provider": "p", "observedAt": observed, "windows": []},
        }

    base = fingerprint(snap(1100, 0.06, "2026-11-19T12:00:00Z"))
    assert fingerprint(snap(1110, 0.10, "2026-11-19T12:05:00Z")) == base
    assert fingerprint(snap(1200, 0.10, "2026-11-19T12:05:00Z")) != base
    assert fingerprint(snap(1100, 0.90, "2026-11-19T12:05:00Z")) != base


@pytest.mark.parametrize(
    "url",
    ["ws://localhost.evil.com/api/collector", "ws://10.0.0.5/api/collector", "http://x/"],
)
def test_validate_url_rejects_non_loopback_insecure(url):
    with pytest.raises(ValueError):
        validate_url(url, allow_insecure=True)


def test_is_fresh():
    from datetime import UTC, datetime, timedelta

    from ai_office_collector.relay import is_fresh

    now = datetime(2026, 11, 19, 12, 0, 30, tzinfo=UTC)
    assert is_fresh(SNAP, now, max_age=30)
    assert not is_fresh(SNAP, now + timedelta(seconds=1), max_age=30)
    assert not is_fresh({**SNAP, "generatedAt": None}, now, max_age=30)
