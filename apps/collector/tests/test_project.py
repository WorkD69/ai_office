"""Isolated mode: projection of systemd credentials and the exporter reading it."""

from __future__ import annotations

import json

import pytest

from ai_office_collector.__main__ import main
from ai_office_collector.project import MAX_INPUT_BYTES, project, project_gateway, project_jobs
from ai_office_collector.snapshot import build_snapshot
from conftest import NOW, FakeProbe, make_config

GATEWAY = {
    "gateway_state": "running",
    "updated_at": NOW.isoformat(),
    "pid": 4242,
    "argv": ["hermes", "gateway", "run"],
    "platforms": {
        "telegram": {"state": "connected", "writer_pid": 7, "metrics": {"tokens": 123}},
        "hunter:telegram": {"state": "weird-new-state"},
        "api_server": {"state": "connected", "listener_base": "http://127.0.0.1:8642"},
    },
}

JOBS = {
    "jobs": [
        {
            "id": "b1589f719c67",
            "name": "scan A",
            "prompt": "SECRET PROMPT with a chat id 123456789",
            "deliver": "telegram:123456789",
            "enabled": True,
            "state": "scheduled",
            "schedule": {"kind": "cron", "expr": "5 8,14,20 * * *"},
            "next_run_at": "2026-11-19T14:05:00+03:00",
            "last_run_at": "2026-11-19T08:05:00+03:00",
            "last_status": "error",
        },
        {"id": "../../etc", "name": "odd id", "schedule": "$(rm -rf /)", "state": "paused"},
        "not a job",
    ]
}


@pytest.fixture
def creds(tmp_path):
    directory = tmp_path / "creds"
    directory.mkdir()
    (directory / "gateway").write_text(json.dumps(GATEWAY), encoding="utf-8")
    (directory / "cron-hunter").write_text(json.dumps(JOBS), encoding="utf-8")
    return directory


def isolated_config(tmp_path, projection):
    return make_config(projection, tmp_path, timezone=None, read_session_state=False)


def test_gateway_projection_keeps_only_allow_listed_fields():
    out = project_gateway(GATEWAY, ("telegram", "hunter:telegram"))
    assert out == {
        "gateway_state": "running",
        "updated_at": "2026-11-19T12:00:00.000Z",
        "platforms": {"telegram": {"state": "connected"}, "hunter:telegram": {"state": "unknown"}},
    }
    assert project_gateway("garbage", ())["gateway_state"] == "stopped"


def test_job_projection_drops_prompts_and_rejects_odd_values():
    jobs = project_jobs(JOBS)
    assert len(jobs) == 2
    assert jobs[0]["schedule"] == "5 8,14,20 * * *" and jobs[0]["last_status"] == "error"
    assert jobs[1] == {
        "id": "job-2",
        "name": "odd id",
        "schedule": "",
        "enabled": False,
        "next_run_at": None,
        "last_run_at": None,
        "last_status": None,
    }
    text = json.dumps(jobs)
    assert "SECRET" not in text and "123456789" not in text


def test_project_then_export_end_to_end(tmp_path, creds):
    projection = tmp_path / "metrics"
    cfg = isolated_config(tmp_path, projection)
    project(cfg, creds, projection, FakeProbe({"broker.service": "failed"}))

    written = {p.relative_to(projection).as_posix() for p in projection.rglob("*.json")}
    assert written == {
        "gateway_state.json",
        "cron/jobs.json",
        "profiles/hunter/cron/jobs.json",
        "unit_states.json",
    }
    assert "pid" not in (projection / "gateway_state.json").read_text(encoding="utf-8")

    snap = build_snapshot(cfg, FakeProbe(), now=NOW)
    by_id = {a["id"]: a for a in snap["agents"]}
    assert by_id["coordinator"]["status"] == "idle"
    assert by_id["coordinator"]["usageToday"] is None  # no session data in isolated mode
    assert by_id["hunter"]["status"] == "error"  # its platform state is "unknown"
    assert by_id["hunter"]["cron"][0]["lastStatus"] == "error"
    # Unit states come from the projection, not from the exporter's own probe.
    assert by_id["signals"]["status"] == "error"


def test_missing_cron_credential_means_no_jobs(tmp_path, creds):
    (creds / "cron-hunter").unlink()
    projection = tmp_path / "metrics"
    project(isolated_config(tmp_path, projection), creds, projection, FakeProbe())
    data = json.loads((projection / "profiles/hunter/cron/jobs.json").read_text(encoding="utf-8"))
    assert data == {"jobs": []}


def test_oversized_credential_is_rejected(tmp_path, creds):
    (creds / "gateway").write_bytes(b" " * (MAX_INPUT_BYTES + 1))
    with pytest.raises(ValueError, match="larger than"):
        project(isolated_config(tmp_path, tmp_path / "m"), creds, tmp_path / "m", FakeProbe())


def test_missing_projected_unit_states_mean_unknown(tmp_path, creds):
    projection = tmp_path / "metrics"
    cfg = isolated_config(tmp_path, projection)
    project(cfg, creds, projection, FakeProbe())
    (projection / "unit_states.json").write_text("[1, 2]", encoding="utf-8")
    snap = build_snapshot(cfg, FakeProbe(), now=NOW)
    signals = next(a for a in snap["agents"] if a["id"] == "signals")
    assert signals["status"] == "offline"


def test_cli_project_requires_a_credentials_directory(tmp_path, creds, monkeypatch):
    config = tmp_path / "collector.toml"
    config.write_text(
        "[collector]\n"
        f"hermes_home = {json.dumps(str(tmp_path / 'metrics'))}\n"
        "read_session_state = false\n"
        "[[agents]]\nid = 'coordinator'\nname = 'C'\nroom = 'hq'\nkind = 'llm'\n"
        "source = 'hermes'\nprofile = 'default'\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("CREDENTIALS_DIRECTORY", raising=False)
    assert main(["project", "--config", str(config), "--output", str(tmp_path / "m")]) == 2
    monkeypatch.setenv("CREDENTIALS_DIRECTORY", str(creds))
    assert main(["project", "--config", str(config), "--output", str(tmp_path / "m")]) == 0
    assert (tmp_path / "m" / "gateway_state.json").is_file()


def test_relay_can_pin_the_egress_address(monkeypatch):
    from ai_office_collector.relay import connect_without_redirects

    monkeypatch.setenv("OFFICE_EGRESS_IPV4", "192.0.2.10")
    client = connect_without_redirects("wss://worker.example/api/collector", "t" * 40)
    assert client.connection_kwargs.get("local_addr") == ("192.0.2.10", 0)
