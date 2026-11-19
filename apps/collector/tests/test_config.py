from __future__ import annotations

from pathlib import Path

import pytest

from ai_office_collector.config import (
    ConfigError,
    HermesSource,
    SystemdSource,
    load_config,
    parse_config,
)

EXAMPLE = Path(__file__).resolve().parents[1] / "config.example.toml"


def base(**agent):
    entry = {"id": "a", "name": "A", "room": "hq", "source": "systemd", "units": ["x.service"]}
    entry.update(agent)
    return {"collector": {"hermes_home": "/data"}, "agents": [entry]}


def test_example_config_is_valid():
    cfg = load_config(EXAMPLE)
    assert [a.id for a in cfg.agents][:2] == ["coordinator", "scout"]
    coord = cfg.agents[0].source
    assert isinstance(coord, HermesSource)
    assert coord.platform == "telegram" and coord.exclude_sources == ("tool",)
    scout = cfg.agents[1].source
    assert isinstance(scout, HermesSource) and scout.platform == "scout:telegram"
    assert "trading-signals.service" in cfg.all_units()
    assert len(cfg.all_units()) == len(set(cfg.all_units()))


def test_defaults():
    cfg = parse_config(base())
    assert cfg.settings.interval_seconds == 5.0
    assert cfg.settings.output == Path("/run/agent-office/snapshot.json")
    assert cfg.settings.quota_file is None
    assert isinstance(cfg.agents[0].source, SystemdSource)


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ({"agents": []}, "[collector] table is required"),
        ({"collector": {"hermes_home": "/d"}}, "at least one [[agents]]"),
        (base(id="Bad Id"), "agents[0].id must match"),
        (base(room="Room 1"), "agents[0].room must match"),
        (base(name="x" * 41), "longer than 40"),
        (base(kind="robot"), "kind must be one of"),
        (base(source="docker"), "source must be 'hermes' or 'systemd'"),
        (base(units=[]), "units must be a non-empty list"),
        (base(units=["x; rm -rf /"]), "invalid systemd unit name"),
        (base(source="hermes", profile="../etc"), "profile has invalid characters"),
        (
            {"collector": {"hermes_home": "/d", "interval_seconds": 0}, "agents": [{}]},
            "interval_seconds must be a positive number",
        ),
    ],
)
def test_config_errors(raw, message):
    with pytest.raises(ConfigError, match=None) as exc:
        parse_config(raw)
    assert message in str(exc.value)


def test_duplicate_ids():
    raw = base()
    raw["agents"].append(dict(raw["agents"][0]))
    with pytest.raises(ConfigError, match="duplicate agent id"):
        parse_config(raw)


def test_missing_and_invalid_files(tmp_path):
    with pytest.raises(ConfigError, match="not found"):
        load_config(tmp_path / "nope.toml")
    bad = tmp_path / "bad.toml"
    bad.write_text("[collector\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="invalid TOML"):
        load_config(bad)
