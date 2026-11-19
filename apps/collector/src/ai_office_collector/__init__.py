"""AI Office collector.

Two small processes with deliberately split privileges:

* ``exporter`` (stdlib only) reads Hermes state files read-only, has no network
  access and writes a sanitised snapshot to ``/run/agent-office/snapshot.json``.
* ``relay`` has network access but cannot read Hermes data: it only forwards that
  snapshot over an outbound WebSocket to the Cloudflare worker.
"""

from .protocol import PROTOCOL_VERSION

__version__ = "0.1.0"
__all__ = ["PROTOCOL_VERSION", "__version__"]
