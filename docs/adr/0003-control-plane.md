# ADR 0003 — Control plane through the local Hermes API

- Status: proposed (phase 3)
- Date: 2026-11-19

## Context

Read-only status does not need Hermes' API at all: everything is available from local files
(`gateway_state.json`, `state.db`, `cron/jobs.json`). Control does: giving an agent a task,
stopping a run, answering an approval, pausing/resuming/running cron jobs.

Hermes v0.21.6 ships an API server (`/v1/runs`, `/v1/runs/{id}/stop`,
`/v1/runs/{id}/approval`, `/api/jobs/...`). In the target deployment it already runs on
`127.0.0.1:8642` **inside** the Hermes container's network namespace and is unreachable from
the host or the network. Its API key grants full toolset access — there is no read-only key.

## Decision (proposed)

1. Keep status collection file-based and read-only (enforced by the OS: the exporter has no
   network and opens SQLite with `mode=ro`).
2. For control, publish the API on the **host loopback only** (`127.0.0.1:8642`). No
   Tailscale exposure is needed because the relay runs on the same host; no public port and
   no Funnel. The built-in Hermes Dashboard stays disabled.
3. The API key lives in a root-only file on the VPS and is given only to the relay process.
   It never reaches the Worker or the browser.
4. The relay executes only allow-listed `Command` actions, each with a UUID, short expiry and
   single-use semantics, and writes an audit record. Dangerous actions require explicit
   confirmation in the UI.
5. Verification before enabling: the office can act, and a foreign client (other host, other
   container, tailnet peer, request without the key) cannot reach the API.

## Consequences

- One Hermes gateway restart is required to change the port mapping; a rollback point of the
  compose file is taken first.
- Whether `/api/jobs` honours `approvals.cron_mode: deny` must be tested before exposing cron
  controls.
