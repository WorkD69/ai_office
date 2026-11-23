"""Outbound relay: forwards the exporter's snapshot to the Cloudflare worker.

The relay runs with network access but *without* access to Hermes data. It reads
only ``snapshot.json`` and keeps one outbound WebSocket open, so the server needs
no inbound port. Commands from the worker are not executed in this version: every
command is answered with a rejection (see ``ALLOWED_ACTIONS``).

Behaviour worth knowing:

* A snapshot older than ``RELAY_MAX_SNAPSHOT_AGE_MS`` is not forwarded (the relay
  keeps sending heartbeats). A dead exporter therefore shows up as stale data in the
  UI instead of a frozen office that looks alive.
* Snapshots are sent when their *content* changes. Volatile fields (timestamps,
  RAM/load/disk noise) are excluded or bucketed, otherwise every export would differ.
* HTTP redirects are never followed: the bearer token must not be replayed to
  another host.
* Backoff resets only after a connection stayed up for a while, and a "replaced"
  close (another collector connected with the same token) backs off for longer,
  so two collectors cannot kick each other in a tight loop.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import random
import socket
import time
import uuid
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .protocol import (
    MAX_COLLECTOR_MESSAGE_BYTES,
    PROTOCOL_VERSION,
    RELAY_MAX_SNAPSHOT_AGE_MS,
    CloseCode,
)
from .timeutil import iso, parse_ts

log = logging.getLogger(__name__)

MAX_MESSAGE_BYTES = MAX_COLLECTOR_MESSAGE_BYTES
INSECURE_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

#: Phase-3 placeholder. Until command execution is implemented and reviewed this
#: stays empty, so the relay cannot act on anything the worker sends.
ALLOWED_ACTIONS: frozenset[str] = frozenset()

#: Bucket sizes for host metrics in the change fingerprint.
_HOST_BUCKETS = {"memUsedMb": 32.0, "load1": 0.25, "diskUsedPercent": 1.0}


@dataclass(frozen=True)
class RelayTiming:
    heartbeat: float = 30.0
    resend: float = 60.0
    poll: float = 1.0
    #: A connection that lived at least this long resets the reconnect backoff.
    stable: float = 60.0
    #: Minimum delay after the worker closed us with ``CloseCode.REPLACED``.
    replaced_backoff: float = 60.0
    max_snapshot_age: float = RELAY_MAX_SNAPSHOT_AGE_MS / 1000


def fingerprint(snapshot: dict[str, Any]) -> str:
    """Hash of the meaningful content of a snapshot.

    Ignores ``generatedAt`` and ``quotas[].observedAt`` (they change on every run) and
    buckets host metrics, so the relay sends on real changes only.
    """
    body = {k: v for k, v in snapshot.items() if k != "generatedAt"}
    quotas = body.get("quotas")
    if isinstance(quotas, list):
        body["quotas"] = [
            {k: v for k, v in q.items() if k != "observedAt"} if isinstance(q, dict) else q
            for q in quotas
        ]
    host = body.get("host")
    if isinstance(host, dict):
        host = dict(host)
        for key, step in _HOST_BUCKETS.items():
            value = host.get(key)
            if isinstance(value, int | float) and not isinstance(value, bool):
                host[key] = math.floor(value / step)
        body["host"] = host
    data = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


@dataclass
class SendPolicy:
    """Send on change, otherwise re-send at least every ``resend`` seconds."""

    resend: float = 60.0
    _last_hash: str | None = field(default=None, init=False)
    _last_sent: float = field(default=float("-inf"), init=False)

    def should_send(self, snapshot: dict[str, Any], now: float) -> bool:
        digest = fingerprint(snapshot)
        if digest != self._last_hash or now - self._last_sent >= self.resend:
            self._last_hash = digest
            self._last_sent = now
            return True
        return False

    def reset(self) -> None:
        """Forget state after a reconnect so the first snapshot is always sent."""
        self._last_hash = None
        self._last_sent = float("-inf")


def snapshot_age(snapshot: dict[str, Any], now: datetime) -> float | None:
    """Seconds since the exporter generated ``snapshot``; None if it has no timestamp."""
    generated = parse_ts(snapshot.get("generatedAt"))
    if generated is None:
        return None
    return (now - generated).total_seconds()


def is_fresh(snapshot: dict[str, Any], now: datetime, max_age: float) -> bool:
    age = snapshot_age(snapshot, now)
    # Small negative ages are clock jitter between processes on the same host.
    return age is not None and -max_age <= age <= max_age


def snapshot_message(snapshot: dict[str, Any]) -> str:
    return json.dumps({"type": "snapshot", "snapshot": snapshot}, ensure_ascii=False)


def fit_message(snapshot: dict[str, Any]) -> str | None:
    """Serialise ``snapshot`` within the worker's size limit, degrading if needed.

    Cron details are the only unbounded-looking part (up to 50 jobs per agent), so they
    are trimmed first; if even that is not enough, nothing is sent.
    """
    message = snapshot_message(snapshot)
    if _size(message) <= MAX_MESSAGE_BYTES:
        return message
    for keep in (10, 0):
        agents = [{**a, "cron": a.get("cron", [])[:keep]} for a in snapshot.get("agents", [])]
        message = snapshot_message({**snapshot, "agents": agents})
        if _size(message) <= MAX_MESSAGE_BYTES:
            log.warning("snapshot too large; cron details trimmed to %d per agent", keep)
            return message
    return None


def heartbeat_message(now: datetime | None = None) -> str:
    return json.dumps({"type": "heartbeat", "at": iso(now or datetime.now(UTC))})


def handle_incoming(raw: str | bytes) -> str | None:
    """Return a reply for a message from the worker, or None.

    Commands are always rejected in this version. Only the message type and the
    command id/action are logged, never arguments.
    """
    if isinstance(raw, bytes) or len(raw) > MAX_MESSAGE_BYTES:
        log.warning("ignored non-text or oversized message")
        return None
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("ignored malformed message")
        return None
    if not isinstance(msg, dict):
        return None
    mtype = msg.get("type")
    if mtype != "command":
        log.info("message from worker: type=%s", str(mtype)[:40])
        return None

    cmd = msg.get("command")
    cmd_id = cmd.get("id") if isinstance(cmd, dict) else None
    action = cmd.get("action") if isinstance(cmd, dict) else None
    if not _is_uuid(cmd_id):
        log.warning("rejected command without a valid id")
        return None
    log.info("command %s action=%s rejected", cmd_id, str(action)[:40])
    # ALLOWED_ACTIONS is empty, so every action ends here. When phase 3 adds actions,
    # this is where expiry, replay and argument checks go before anything executes.
    detail = (
        "commands are not enabled on this collector"
        if action not in ALLOWED_ACTIONS
        else "not implemented"
    )
    return json.dumps(
        {"type": "command_result", "commandId": cmd_id, "ok": False, "detail": detail}
    )


def backoff_delays(base: float = 1.0, cap: float = 60.0) -> Iterator[float]:
    """Exponential backoff with full jitter: up to 1s, 2s, 4s ... capped at ``cap``."""
    attempt = 0
    while True:
        yield random.uniform(0, min(cap, base * 2**attempt))
        attempt = min(attempt + 1, 16)


def read_snapshot(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict) or data.get("v") != PROTOCOL_VERSION:
        return None
    return data


def validate_url(url: str, allow_insecure: bool) -> str:
    """Accept ``wss://host/...``; plain ``ws://`` only to loopback with ``allow_insecure``."""
    parts = urlsplit(url)
    host = parts.hostname
    if parts.scheme == "wss" and host:
        return url
    if allow_insecure and parts.scheme == "ws" and host in INSECURE_HOSTS:
        return url
    raise ValueError(
        "worker URL must start with wss:// (ws://localhost only with --allow-insecure)"
    )


def connect_without_redirects(url: str, token: str) -> Any:
    """``websockets`` client that never follows redirects (the token stays with the worker)."""
    from websockets.asyncio.client import connect

    class _NoRedirectConnect(connect):
        def process_redirect(self, exc: Exception) -> Exception | str:
            return exc

    egress = os.environ.get("OFFICE_EGRESS_IPV4")
    network = {"family": socket.AF_INET, "local_addr": (egress, 0)} if egress else {}
    return _NoRedirectConnect(
        url,
        additional_headers={"Authorization": f"Bearer {token}"},
        proxy=None,
        max_size=MAX_MESSAGE_BYTES,
        open_timeout=15,
        ping_interval=20,
        ping_timeout=20,
        **network,
    )


Sleep = Callable[[float], Awaitable[None]]


async def run_relay(
    url: str,
    token: str,
    snapshot_path: Path,
    *,
    timing: RelayTiming | None = None,
    sleep: Sleep = asyncio.sleep,
    clock: Callable[[], float] = time.monotonic,
    wall: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> None:
    """Main loop: connect, stream snapshots, reconnect with backoff. Runs until cancelled."""
    from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidStatus

    timing = timing or RelayTiming()
    policy = SendPolicy(resend=timing.resend)
    delays = backoff_delays()
    while True:
        started = clock()
        close_code: int | None = None
        try:
            async with connect_without_redirects(url, token) as ws:
                log.info("connected to worker")
                policy.reset()
                await _session(ws, policy, snapshot_path, timing, clock, wall)
                close_code = ws.close_code
                log.info("worker closed the connection: code=%s", close_code)
        except InvalidStatus as exc:
            # 401/403 means a wrong token; 3xx is a redirect we refuse to follow.
            log.error("worker refused connection: HTTP %s", exc.response.status_code)
        except ConnectionClosed as exc:
            close_code = exc.rcvd.code if exc.rcvd else None
            reason = exc.rcvd.reason[:80] if exc.rcvd else ""
            log.warning("connection closed: code=%s reason=%r", close_code, reason)
        except (InvalidHandshake, OSError, TimeoutError) as exc:
            log.warning("connection failed: %s", type(exc).__name__)

        if clock() - started >= timing.stable:
            delays = backoff_delays()  # it was a healthy connection, start over
        delay = next(delays)
        if close_code == CloseCode.REPLACED:
            delay = max(delay, timing.replaced_backoff)
            log.warning("replaced by another collector using the same token")
        log.info("reconnecting in %.1fs", delay)
        await sleep(delay)


async def _session(
    ws: Any,
    policy: SendPolicy,
    snapshot_path: Path,
    timing: RelayTiming,
    clock: Callable[[], float],
    wall: Callable[[], datetime],
) -> None:
    async def receiver() -> None:
        async for raw in ws:
            reply = handle_incoming(raw)
            if reply is not None:
                await ws.send(reply)

    async def sender() -> None:
        last_heartbeat = float("-inf")
        stale_reported = False
        while True:
            now = clock()
            snapshot = read_snapshot(snapshot_path)
            if snapshot is not None and not is_fresh(snapshot, wall(), timing.max_snapshot_age):
                if not stale_reported:
                    log.warning("snapshot is stale or undated; is the exporter running?")
                    stale_reported = True
            elif snapshot is not None:
                stale_reported = False
                if policy.should_send(snapshot, now):
                    message = fit_message(snapshot)
                    if message is None:
                        log.error(
                            "snapshot exceeds %d bytes even without cron details", MAX_MESSAGE_BYTES
                        )
                    else:
                        await ws.send(message)
            if now - last_heartbeat >= timing.heartbeat:
                await ws.send(heartbeat_message(wall()))
                last_heartbeat = now
            await asyncio.sleep(timing.poll)

    tasks = [asyncio.create_task(receiver()), asyncio.create_task(sender())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()  # re-raise errors; a clean close also ends the session
    finally:
        for task in tasks:
            task.cancel()


def _size(message: str) -> int:
    return len(message.encode("utf-8"))


def _is_uuid(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True
