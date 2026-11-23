"""End-to-end test of the relay loop against an in-process WebSocket server (no network)."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from websockets.asyncio.server import serve

from ai_office_collector.protocol import CloseCode
from ai_office_collector.relay import RelayTiming, connect_without_redirects, run_relay


class StopLoop(Exception):
    """Raised by the fake sleep to end ``run_relay`` after the first reconnect decision."""


def write_snapshot(path, generated_at: datetime) -> None:
    snapshot = {
        "v": 2,
        "generatedAt": generated_at.isoformat().replace("+00:00", "Z"),
        "agents": [],
        "quotas": [],
        "host": None,
    }
    path.write_text(json.dumps(snapshot), encoding="utf-8")


def command(action: str = "cron.run") -> str:
    now = datetime.now(UTC)
    return json.dumps(
        {
            "type": "command",
            "command": {
                "id": str(uuid.uuid4()),
                "action": action,
                "agentId": "scout",
                "args": {},
                "issuedAt": now.isoformat(),
                "expiresAt": (now + timedelta(seconds=30)).isoformat(),
            },
        }
    )


async def drive(snapshot_path, handler) -> tuple[list[float], list[dict]]:
    received: list[dict] = []
    delays: list[float] = []

    async def fake_sleep(delay: float) -> None:
        delays.append(delay)
        raise StopLoop

    async def wrapped(ws):
        await handler(ws, received)

    async with serve(wrapped, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        timing = RelayTiming(heartbeat=0.05, resend=60, poll=0.01, stable=60)
        with pytest.raises(StopLoop):
            await asyncio.wait_for(
                run_relay(
                    f"ws://127.0.0.1:{port}/api/collector",
                    "test-token",
                    snapshot_path,
                    timing=timing,
                    sleep=fake_sleep,
                ),
                timeout=10,
            )
    return delays, received


async def collect(ws, received: list[dict], want: set[str]) -> None:
    while not want <= {m["type"] for m in received}:
        received.append(json.loads(await ws.recv()))


def test_streams_snapshot_heartbeat_rejects_commands_and_backs_off_when_replaced(tmp_path):
    snapshot_path = tmp_path / "snapshot.json"
    write_snapshot(snapshot_path, datetime.now(UTC))
    auth_headers: list[str | None] = []

    async def handler(ws, received):
        auth_headers.append(ws.request.headers.get("Authorization"))
        await collect(ws, received, {"snapshot", "heartbeat"})
        await ws.send(command())
        await collect(ws, received, {"command_result"})
        await ws.close(CloseCode.REPLACED, "replaced")

    delays, received = asyncio.run(drive(snapshot_path, handler))

    assert auth_headers == ["Bearer test-token"]
    result = next(m for m in received if m["type"] == "command_result")
    assert result["ok"] is False  # nothing is executable until phase 3
    assert delays and delays[0] >= 60  # replaced -> long back-off, no reconnect fight


def test_stale_snapshot_is_not_forwarded_but_heartbeats_continue(tmp_path):
    snapshot_path = tmp_path / "snapshot.json"
    write_snapshot(snapshot_path, datetime.now(UTC) - timedelta(minutes=5))

    async def handler(ws, received):
        await collect(ws, received, {"heartbeat"})
        await asyncio.sleep(0.1)  # several poll cycles with a stale file
        await ws.close()

    _, received = asyncio.run(drive(snapshot_path, handler))
    assert {m["type"] for m in received} == {"heartbeat"}


def test_redirects_are_never_followed():
    client = connect_without_redirects("wss://worker.example/api/collector", "secret")
    original = Exception("302 to another host")
    assert client.process_redirect(original) is original
