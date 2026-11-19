from __future__ import annotations

from ai_office_collector.hermes import StateDb, read_cron_jobs, read_gateway
from conftest import NOW, minutes, ts


def test_read_gateway(hermes):
    assert read_gateway(hermes.home) is None
    hermes.gateway(platforms={"telegram": "connected", "api_server": "connected"})
    gw = read_gateway(hermes.home)
    assert gw is not None and gw.running
    assert gw.updated_at == NOW
    assert gw.platforms == {"telegram": "connected", "api_server": "connected"}


def test_read_gateway_tolerates_garbage(hermes):
    (hermes.home / "gateway_state.json").write_text("{not json", encoding="utf-8")
    assert read_gateway(hermes.home) is None


def test_latest_session_skips_excluded_and_archived(hermes):
    hermes.session(
        "default",
        source="telegram",
        started_at=ts(NOW - minutes(30)),
        last_activity_at=ts(NOW - minutes(20)),
        last_activity_description="older chat",
    )
    hermes.session(
        "default",
        source="tool",
        started_at=ts(NOW - minutes(1)),
        last_activity_at=ts(NOW),
        last_activity_description="broker call",
    )
    hermes.session(
        "default",
        source="telegram",
        started_at=ts(NOW - minutes(5)),
        last_activity_at=ts(NOW - minutes(2)),
        last_activity_description="archived",
        archived=1,
    )
    db = StateDb(hermes.home / "state.db")

    s = db.latest_session(exclude_sources=("tool",))
    assert s is not None and s.description == "older chat"
    assert db.latest_session().description == "broker call"


def test_state_db_is_opened_read_only(hermes):
    hermes.session("default", started_at=ts(NOW))
    db = StateDb(hermes.home / "state.db")
    conn = db._connect()
    try:
        try:
            conn.execute("DELETE FROM sessions")
        except Exception as exc:  # sqlite3.OperationalError: readonly database
            assert "readonly" in str(exc).lower() or "read-only" in str(exc).lower()
        else:
            raise AssertionError("write unexpectedly succeeded")
    finally:
        conn.close()


def test_usage_since_counts_only_rows_seen_after_midnight(hermes):
    midnight = NOW.replace(hour=0)
    hermes.usage(
        "default",
        api_call_count=3,
        input_tokens=1000,
        output_tokens=50,
        cache_read_tokens=900,
        last_seen=ts(midnight + minutes(1)),
    )
    hermes.usage(
        "default",
        api_call_count=7,
        input_tokens=5000,
        output_tokens=10,
        cache_read_tokens=0,
        last_seen=ts(midnight - minutes(1)),
    )
    hermes.usage(
        "default",
        api_call_count=2,
        input_tokens=None,
        output_tokens=5,
        cache_read_tokens=10,
        last_seen=(NOW - minutes(5)).isoformat(),
    )
    u = StateDb(hermes.home / "state.db").usage_since(midnight)
    assert (u.api_calls, u.input_tokens, u.output_tokens, u.cache_read_tokens) == (5, 1000, 55, 910)


def test_read_cron_jobs_maps_fields_and_never_reads_prompts(hermes):
    hermes.jobs(
        "hunter",
        [
            {
                "id": "abc",
                "name": "oh-scan-A",
                "prompt": "SECRET PROMPT",
                "enabled": True,
                "state": "scheduled",
                "schedule": {"kind": "cron", "expr": "5 8 * * *", "display": "5 8 * * *"},
                "next_run_at": "2026-11-19T14:05:00+03:00",
                "last_run_at": "2026-11-19T08:05:00+03:00",
                "last_status": "error",
            },
            {
                "name": "digest",
                "enabled": True,
                "state": "paused",
                "schedule": "every 2h",
                "last_status": None,
            },
            {"name": "weird", "last_status": "exploded"},
            "not a dict",
        ],
    )
    jobs = read_cron_jobs(hermes.home / "profiles" / "hunter")
    assert [j["id"] for j in jobs] == ["abc", "digest", "weird"]
    first = jobs[0]
    assert first == {
        "id": "abc",
        "name": "oh-scan-A",
        "schedule": "5 8 * * *",
        "enabled": True,
        "nextRunAt": "2026-11-19T11:05:00.000Z",
        "lastRunAt": "2026-11-19T05:05:00.000Z",
        "lastStatus": "error",
    }
    assert jobs[1]["enabled"] is False and jobs[1]["lastStatus"] is None
    assert jobs[2]["lastStatus"] == "unknown"
    assert "SECRET" not in repr(jobs)


def test_read_cron_jobs_missing_file(hermes):
    assert read_cron_jobs(hermes.home) == []


def test_private_copy_mode_sees_wal_writes_and_never_touches_the_source(hermes, tmp_path):
    src = hermes.home / "state.db"
    conn = hermes.db("default")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA wal_autocheckpoint=0")  # keep new rows in the -wal file
    conn.execute(
        "INSERT INTO sessions (id, source, started_at, last_activity_description) "
        "VALUES (?, 'telegram', ?, ?)",
        ("a", ts(NOW - minutes(5)), "first"),
    )
    conn.commit()

    before = {p.name for p in src.parent.iterdir()}
    work = tmp_path / "work"
    db = StateDb(src, work_dir=work)
    assert db.latest_session().description == "first"

    # A new write that only exists in the WAL is picked up on the next read.
    conn.execute(
        "INSERT INTO sessions (id, source, started_at, last_activity_description) "
        "VALUES (?, 'telegram', ?, ?)",
        ("b", ts(NOW), "second"),
    )
    conn.commit()
    assert db.latest_session().description == "second"
    conn.close()

    assert {p.name for p in src.parent.iterdir()} <= before | {"state.db-wal", "state.db-shm"}
    db.invalidate()
    assert not any(work.iterdir())


def test_latest_session_finds_target_behind_many_excluded_ones(hermes):
    # Regression: on the real server hundreds of newer `tool` sessions hid the chat session.
    hermes.session(
        "default",
        source="telegram",
        started_at=ts(NOW - minutes(90)),
        last_activity_description="chat",
    )
    for i in range(80):
        hermes.session("default", source="tool", started_at=ts(NOW - minutes(i)))
    s = StateDb(hermes.home / "state.db").latest_session(exclude_sources=("tool",))
    assert s is not None and s.description == "chat"


def test_duplicate_long_cron_ids_get_unique_suffixes(hermes):
    long_id = "x" * 64
    hermes.jobs(
        "hunter",
        [{"id": long_id, "name": "a"}, {"id": long_id, "name": "b"}, {"id": long_id, "name": "c"}],
    )
    ids = [j["id"] for j in read_cron_jobs(hermes.home / "profiles" / "hunter")]
    assert len(set(ids)) == 3 and all(len(i) <= 64 for i in ids)


def test_read_gateway_tolerates_unexpected_platform_shapes(hermes):
    (hermes.home / "gateway_state.json").write_text(
        '{"gateway_state": "running", "platforms": ["telegram"]}', encoding="utf-8"
    )
    gw = read_gateway(hermes.home)
    assert gw is not None and gw.running and gw.platforms == {}
