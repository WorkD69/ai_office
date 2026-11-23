from __future__ import annotations

import json
import os
from dataclasses import replace
from pathlib import Path

import pytest

from ai_office_collector.snapshot import build_snapshot, load_quota, write_atomic
from conftest import NOW, FakeProbe, make_config, minutes, ts

GOLDEN = Path(__file__).parent / "golden" / "snapshot.json"


def populate(hermes) -> None:
    """A small synthetic office: one busy agent, one with failing cron, one idle bot."""
    hermes.gateway(platforms={"telegram": "connected", "hunter:telegram": "connected"})
    hermes.session(
        "default",
        source="telegram",
        started_at=ts(NOW - minutes(3)),
        last_activity_at=ts(NOW - minutes(0.5)),
        last_activity_description="Searching the web for flight prices",
        title="Trip planning",
        model="gpt-6-luna",
    )
    hermes.session(
        "default",
        source="tool",
        started_at=ts(NOW - minutes(0.2)),
        last_activity_at=ts(NOW),
        title="broker call",
        model="gpt-6-luna",
    )
    hermes.usage(
        "default",
        api_call_count=12,
        input_tokens=180000,
        output_tokens=2400,
        cache_read_tokens=150000,
        last_seen=ts(NOW - minutes(60)),
    )
    hermes.usage(
        "default",
        api_call_count=99,
        input_tokens=1,
        output_tokens=1,
        cache_read_tokens=1,
        last_seen=ts(NOW - minutes(60 * 30)),
    )
    hermes.session(
        "hunter",
        source="telegram",
        started_at=ts(NOW - minutes(600)),
        ended_at=ts(NOW - minutes(590)),
        last_activity_at=ts(NOW - minutes(590)),
        title="Digest",
        model="gpt-6-luna",
    )
    hermes.jobs(
        "hunter",
        [
            {
                "id": "scan-a",
                "name": "scan A",
                "enabled": True,
                "state": "scheduled",
                "schedule": {
                    "kind": "cron",
                    "expr": "5 8,14,20 * * *",
                    "display": "5 8,14,20 * * *",
                },
                "next_run_at": "2026-11-19T14:05:00+03:00",
                "last_run_at": "2026-11-19T08:05:00+03:00",
                "last_status": "error",
                "prompt": "never exported",
            },
            {
                "id": "daily",
                "name": "daily digest",
                "enabled": True,
                "state": "scheduled",
                "schedule": {"kind": "cron", "expr": "0 22 * * *", "display": "0 22 * * *"},
                "next_run_at": "2026-11-19T22:00:00+03:00",
                "last_run_at": None,
                "last_status": None,
            },
        ],
    )


def test_snapshot_matches_golden(hermes, tmp_path):
    populate(hermes)
    (tmp_path / "quota.json").write_text(
        json.dumps(
            {
                "provider": "openai-codex",
                "observedAt": "2026-11-19T11:58:00+00:00",
                "windows": [
                    {"name": "5h", "usedPercent": 41.25, "resetsAt": "2026-11-19T14:00:00Z"},
                    {"name": "week", "usedPercent": 6, "resetsAt": None},
                ],
            }
        ),
        encoding="utf-8",
    )
    cfg = make_config(hermes.home, tmp_path, timezone=None)
    snap = build_snapshot(cfg, FakeProbe({"broker.service": "failed"}), now=NOW)

    if os.environ.get("UPDATE_GOLDEN"):
        GOLDEN.parent.mkdir(exist_ok=True)
        GOLDEN.write_text(json.dumps(snap, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    assert snap == json.loads(GOLDEN.read_text(encoding="utf-8"))

    by_id = {a["id"]: a for a in snap["agents"]}
    assert by_id["coordinator"]["status"] == "working"  # tool session excluded
    assert by_id["coordinator"]["usageToday"]["apiCalls"] == 12
    assert by_id["hunter"]["status"] == "idle"
    assert by_id["hunter"]["cron"][0]["lastStatus"] == "error"
    assert by_id["signals"]["status"] == "error"
    assert "never exported" not in json.dumps(snap)
    # Office v2, stage 1: description and chat link from the manual config, no passports yet.
    assert by_id["hunter"]["summary"] == "Looks for internships, once a day"
    assert by_id["hunter"]["chatUrl"] == "https://t.me/example_hunter_bot"
    assert by_id["coordinator"]["summary"] is None
    assert all(a["hasPassport"] is False and a["counters"] == [] for a in snap["agents"])
    assert [q["provider"] for q in snap["quotas"]] == ["openai-codex"]


def test_one_broken_agent_does_not_hide_the_others(hermes, tmp_path):
    hermes.gateway()
    (hermes.home / "state.db").write_bytes(b"this is not a sqlite database at all" * 10)
    cfg = make_config(hermes.home, tmp_path)
    snap = build_snapshot(cfg, FakeProbe(), now=NOW)
    by_id = {a["id"]: a for a in snap["agents"]}
    assert by_id["coordinator"]["status"] == "error"
    assert by_id["coordinator"]["activity"].startswith("collector: ")
    assert by_id["hunter"]["status"] == "offline"  # its state.db does not exist
    assert by_id["signals"]["status"] == "idle"


def test_gateway_down_marks_hermes_agents_offline(hermes, tmp_path):
    hermes.gateway(running=False)
    hermes.session("default", started_at=ts(NOW), last_activity_at=ts(NOW))
    cfg = make_config(hermes.home, tmp_path)
    snap = build_snapshot(cfg, FakeProbe(), now=NOW)
    assert snap["agents"][0]["status"] == "offline"


@pytest.mark.parametrize(
    "content",
    [
        "not json",
        json.dumps([]),
        json.dumps({"provider": "x", "windows": []}),  # no observedAt
        json.dumps({"provider": "x", "observedAt": "2026-11-19T00:00:00Z", "windows": "nope"}),
    ],
)
def test_load_quota_rejects_bad_files(tmp_path, content):
    p = tmp_path / "quota.json"
    p.write_text(content, encoding="utf-8")
    assert load_quota(p) is None


def test_load_quota_clamps_and_skips_bad_windows(tmp_path):
    p = tmp_path / "quota.json"
    p.write_text(
        json.dumps(
            {
                "provider": "openai-codex",
                "observedAt": "2026-11-19T00:00:00Z",
                "windows": [
                    {"name": "5h", "usedPercent": 140},
                    {"name": "w", "usedPercent": "5"},
                    {"usedPercent": 1},
                    {"name": "a", "usedPercent": 1},
                    {"name": "b", "usedPercent": 1},
                    {"name": "c", "usedPercent": 1},
                ],
            }
        ),
        encoding="utf-8",
    )
    q = load_quota(p)
    assert q is not None
    assert q["windows"][0] == {"name": "5h", "usedPercent": 100.0, "resetsAt": None}
    assert [w["name"] for w in q["windows"]] == ["5h", "a"]
    assert load_quota(tmp_path / "missing.json") is None


def test_write_atomic(tmp_path):
    target = tmp_path / "run" / "snapshot.json"
    write_atomic(target, {"v": 1, "text": "привет"})
    write_atomic(target, {"v": 1, "text": "second"})
    assert json.loads(target.read_text(encoding="utf-8")) == {"v": 1, "text": "second"}
    assert [p.name for p in target.parent.iterdir()] == ["snapshot.json"]  # no temp leftovers
    if os.name == "posix":
        assert target.stat().st_mode & 0o777 == 0o644


GOLDEN_MAX = Path(__file__).parent / "golden" / "snapshot-max.json"


def test_worst_case_lengths_stay_within_schema_limits(hermes, tmp_path):
    """Every free-text field at or beyond its limit; validated by the zod contract test."""
    hermes.gateway(platforms={"telegram": "connected", "hunter:telegram": "connected"})
    hermes.session(
        "default",
        source="telegram",
        started_at=ts(NOW - minutes(1)),
        last_activity_at=ts(NOW),
        last_activity_description="‮" + "Very long activity line with words " * 30 + "\x07",
        model="gpt model " * 20,
    )
    hermes.session("hunter", source="telegram", started_at=ts(NOW - minutes(30)))
    hermes.jobs(
        "hunter",
        [
            {
                "id": "j" * 100,
                "name": "Long job name " * 20,
                "enabled": True,
                "schedule": {"display": "every 2 hours " * 20},
                "last_status": "error",
            }
            for _ in range(60)
        ],
    )
    (tmp_path / "quota.json").write_text(
        json.dumps(
            {
                "provider": "provider " * 12,
                "observedAt": "2026-11-19T11:58:00+00:00",
                "windows": [{"name": "window " * 10, "usedPercent": 250, "resetsAt": None}] * 10,
            }
        ),
        encoding="utf-8",
    )
    cfg = make_config(hermes.home, tmp_path, timezone=None)
    longest = replace(
        cfg.agents[1],
        summary="Описание агента " * 7 + "конец ок",  # exactly 120
        chat_url="https://t.me/" + "b" * 32 + "?start=" + "s" * 64,
        project="p" * 48,
    )
    cfg = replace(cfg, agents=(cfg.agents[0], longest, *cfg.agents[2:]))
    snap = build_snapshot(cfg, FakeProbe({}), now=NOW)

    if os.environ.get("UPDATE_GOLDEN"):
        GOLDEN_MAX.write_text(
            json.dumps(snap, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    assert snap == json.loads(GOLDEN_MAX.read_text(encoding="utf-8"))
