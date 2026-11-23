"""Wire constants mirrored from ``packages/protocol/src/{constants,schema}.ts``.

The TypeScript files are the source of truth. ``tests/test_protocol.py`` parses them
and fails if any value here drifts.
"""

from __future__ import annotations

import re

#: ``PROTOCOL_VERSION`` in schema.ts; the worker rejects other versions.
PROTOCOL_VERSION = 2

#: ``CHAT_URL_PATTERN`` in schema.ts: a Telegram username link, optionally with ``?start=``.
CHAT_URL_RE = re.compile(r"^https://t\.me/[A-Za-z0-9_]{5,32}(\?start=[A-Za-z0-9_-]{1,64})?$")

#: ``ReasonCode`` in schema.ts: the collector's fixed status reasons, sent as ``Agent.reason``.
REASON_CODES = (
    "gateway_missing",
    "gateway_stopped",
    "gateway_stale",
    "platform_missing",
    "platform_down",
    "state_db_missing",
    "no_units",
    "unit_failed",
    "unit_down",
    "collector_error",
)

#: ``PlatformState`` in schema.ts: messaging platform states the collector passes on; any other
#: value becomes ``unknown`` so no arbitrary word from the server reaches the feed history.
PLATFORM_STATES = ("connected", "connecting", "disconnected", "error", "stopped", "unknown")

#: ``UnitState`` in schema.ts: ``systemctl is-active`` answers; anything else becomes ``unknown``.
UNIT_STATES = (
    "active",
    "inactive",
    "failed",
    "activating",
    "deactivating",
    "reloading",
    "refreshing",
    "maintenance",
    "unknown",
)

#: ``REASON_PARAM_MAX`` in schema.ts: longest reason parameter value, in UTF-16 units.
REASON_PARAM_MAX = 80

#: ``Snapshot.quotas`` holds at most this many entries.
MAX_QUOTAS = 4

#: Subprotocol the browser offers (the collector authenticates with a bearer token instead).
WS_SUBPROTOCOL = "ai-office"

#: Largest WebSocket message the worker accepts from the collector.
MAX_COLLECTOR_MESSAGE_BYTES = 256 * 1024

#: The relay refuses to forward snapshots older than this, so a dead exporter is visible.
RELAY_MAX_SNAPSHOT_AGE_MS = 30_000


class CloseCode:
    """WebSocket close codes used by the worker."""

    POLICY_VIOLATION = 1008
    MESSAGE_TOO_BIG = 1009
    SESSION_EXPIRED = 4401
    #: A newer collector connection replaced this one; back off instead of fighting it.
    REPLACED = 4409
