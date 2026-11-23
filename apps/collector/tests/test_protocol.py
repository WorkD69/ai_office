"""Fails when the Python mirror of the wire constants drifts from the TypeScript source."""

from __future__ import annotations

import re
from pathlib import Path

from ai_office_collector import protocol

PROTOCOL_SRC = Path(__file__).resolve().parents[3] / "packages" / "protocol" / "src"


def ts_number(source: str, name: str) -> int:
    match = re.search(rf"\b{name}\s*[:=]\s*([\d_ *]+)", source)
    assert match, f"{name} not found in TypeScript sources"
    expression = match.group(1).replace("_", "").strip()
    assert re.fullmatch(r"\d+(\s*\*\s*\d+)*", expression), expression
    value = 1
    for factor in expression.split("*"):
        value *= int(factor)
    return value


def test_constants_match_typescript():
    constants = (PROTOCOL_SRC / "constants.ts").read_text(encoding="utf-8")
    schema = (PROTOCOL_SRC / "schema.ts").read_text(encoding="utf-8")

    assert ts_number(schema, "PROTOCOL_VERSION") == protocol.PROTOCOL_VERSION
    assert f"WS_SUBPROTOCOL = '{protocol.WS_SUBPROTOCOL}'" in constants
    assert (
        ts_number(constants, "MAX_COLLECTOR_MESSAGE_BYTES") == protocol.MAX_COLLECTOR_MESSAGE_BYTES
    )
    assert ts_number(constants, "RELAY_MAX_SNAPSHOT_AGE_MS") == protocol.RELAY_MAX_SNAPSHOT_AGE_MS
    for ts_name, py_name in [
        ("PolicyViolation", "POLICY_VIOLATION"),
        ("MessageTooBig", "MESSAGE_TOO_BIG"),
        ("SessionExpired", "SESSION_EXPIRED"),
        ("Replaced", "REPLACED"),
    ]:
        assert ts_number(constants, ts_name) == getattr(protocol.CloseCode, py_name)


def test_chat_url_pattern_matches_typescript():
    schema = (PROTOCOL_SRC / "schema.ts").read_text(encoding="utf-8")
    match = re.search(r"CHAT_URL_PATTERN = /(.+)/;", schema)
    assert match, "CHAT_URL_PATTERN not found in schema.ts"
    assert match.group(1).replace("\\/", "/") == protocol.CHAT_URL_RE.pattern
