from __future__ import annotations

import json

from ai_office_collector.__main__ import main
from ai_office_collector.quota import quota_from_hermes_usage

# Synthetic example in the shape printed by `hermes usage --json` (v0.21.6).
USAGE = {
    "provider": "openai-codex",
    "source": "account",
    "title": "Codex usage",
    "plan": "plus",
    "fetched_at": "2026-11-19T10:30:00.123456+00:00",
    "windows": [
        {"label": "Session", "used_percent": 40, "resets_at": "2026-11-19T13:00:00+00:00"},
        {"label": "Weekly", "used_percent": 6.04, "resets_at": "2026-11-24T00:00:00+00:00"},
        {"label": "Weird", "used_percent": "n/a"},
    ],
    "details": ["Plan: plus"],
    "unavailable_reason": None,
}


def test_converts_codex_windows():
    assert quota_from_hermes_usage(USAGE) == {
        "provider": "openai-codex",
        "observedAt": "2026-11-19T10:30:00.123Z",
        "windows": [
            {"name": "5h", "usedPercent": 40.0, "resetsAt": "2026-11-19T13:00:00.000Z"},
            {"name": "week", "usedPercent": 6.0, "resetsAt": "2026-11-24T00:00:00.000Z"},
        ],
    }


def test_unavailable_or_malformed():
    assert quota_from_hermes_usage({**USAGE, "unavailable_reason": "no credential"}) is None
    assert quota_from_hermes_usage({**USAGE, "fetched_at": None}) is None
    assert quota_from_hermes_usage([]) is None


def test_quota_cli_writes_file(tmp_path, monkeypatch, capsys):
    import io

    out = tmp_path / "quota.json"
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(USAGE)))
    assert main(["quota", "--output", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["windows"][0]["name"] == "5h"

    monkeypatch.setattr("sys.stdin", io.StringIO("garbage"))
    assert main(["quota", "--output", str(out)]) == 1
    # the previous good file is kept
    assert json.loads(out.read_text(encoding="utf-8"))["provider"] == "openai-codex"
