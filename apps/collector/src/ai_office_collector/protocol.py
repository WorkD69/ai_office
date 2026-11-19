"""Wire constants mirrored from ``packages/protocol/src/{constants,schema}.ts``.

The TypeScript files are the source of truth. ``tests/test_protocol.py`` parses them
and fails if any value here drifts.
"""

from __future__ import annotations

#: ``PROTOCOL_VERSION`` in schema.ts; the worker rejects other versions.
PROTOCOL_VERSION = 1

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
