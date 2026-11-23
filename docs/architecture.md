# Architecture

AI Office is a live dashboard for a small fleet of personal AI agents
([Hermes Agent](https://github.com/NousResearch/hermes-agent) profiles, plain bots and
coding agents), rendered as a pixel-art office. It is built around three constraints of
the real deployment:

1. Agents run on a **tiny VPS** (1 vCPU, 2 GB RAM, shared with other services).
2. The VPS must expose **no inbound ports**.
3. The owner wants the office on a **phone (Telegram Mini App)** and on a desktop, so the
   UI needs a public HTTPS origin that is up even when the VPS or the laptop is not.

## Overview

```
 Telegram Mini App (phone)        Telegram Desktop / browser
            \                          /
             \-------- HTTPS ---------/
                         v
   Cloudflare Worker (Hono)  ── static assets (apps/web)
        |  /api/auth/telegram   initData HMAC -> 12 h session token
        |  /api/ws              viewers (session token)
        |  /api/collector       collector (bearer token)
        v
   Durable Object "Office" (SQLite, WebSocket Hibernation)
        latest snapshot · feed (last 300 events) · derived "needs you" inbox
                         ^
                         |  outbound WSS, initiated by the VPS
 ── VPS ─────────────────┼──────────────────────────────────────────────
   office-relay      (DynamicUser, venv + websockets, cannot read Hermes data)
                         ^
                         |  /run/agent-office/snapshot.json  (sanitised)
   office-exporter   (stdlib only, PrivateNetwork=yes: no network at all)
        isolated mode (default): reads only the projection below, never Hermes data
        full mode (opt-in): also reads a private copy of state.db with CAP_DAC_READ_SEARCH
                         ^
                         |  /run/ai-office-metrics  (allow-listed projection)
   office-status     (timer, no network) gets gateway_state.json + cron/jobs.json
                     from systemd LoadCredential=, plus systemctl is-active <allow-list>
```

## Components

| Path                | Tech                                      | Responsibility                                                                                                         |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | TypeScript, zod                           | Single source of truth for the wire format, plus pure helpers: `diffSnapshots` (feed) and `deriveInbox` ("needs you"). |
| `apps/worker`       | Cloudflare Workers, Hono, Durable Objects | Auth, WebSocket fan-out, persistence of the latest snapshot and feed.                                                  |
| `apps/web`          | React 19, Vite, Canvas 2D                 | Pixel office scene + accessible DOM panel; demo mode for visitors.                                                     |
| `apps/collector`    | Python 3.12                               | Exporter (reads local state, no network) and relay (pushes to the worker).                                             |

## Data flow

1. Every few seconds the **exporter** builds a `Snapshot` from local files and writes it
   atomically. It has no network namespace, so even a bug cannot leak data off the box.
2. The **relay** reads that file and pushes it over an outbound WebSocket when it changes
   (plus heartbeats). It has no access to Hermes data or secrets other than its own token.
3. The **Durable Object** validates the message with the shared zod schema, diffs it
   against the previous snapshot to produce feed events, derives the inbox and broadcasts
   the new state to connected viewers. It hibernates between messages, so it costs nothing
   while idle.
4. The **web app** authenticates with Telegram Mini App `initData`, opens a WebSocket and
   renders. Outside Telegram it runs a seeded, synthetic demo instead (no real data is public).

## Protocol v2: codes, not text

Feed events and "needs you" items carry a `code` and `params` (agent name, status, job name,
outcome), never ready-made sentences; the web app renders them with i18n (`apps/web/src/lib/messages.ts`):
Russian for the owner in live mode, English in the public demo, `?lang=` overrides. Snapshots carry
`quotas[]` (up to four) and optional agent card fields (`summary`, `chatUrl` limited to
`https://t.me/<username>`, `counters`, `hasPassport`, `project`); in stage 1 the collector fills
`summary`, `chatUrl` and `project` from its manual config.

Pitfalls:

- The Durable Object outlives deployments. Feed events stored by protocol v1 only have English
  `text`; the schema still accepts them and the web app shows `text` when there is no `code`.
  A v1 snapshot in storage is upgraded on load (`restoreSnapshot` in `apps/worker/src/core.ts`).
- The Worker accepts exactly one protocol version, so the Worker and the collector are deployed
  together on a version bump.
- A failed scheduled job is a `cron_failed` item and a `cron_ran` event; it never changes the
  agent's status (pinned by a protocol test).

## Status model

`working · waiting_you · waiting_external · error · idle · offline` — `waiting_you` is
separate from `waiting_external` because the first question the dashboard answers is
"what needs me right now". How each status is derived from Hermes files is documented in
[`apps/collector/README.md`](../apps/collector/README.md).

## Control (phase 3, not enabled yet)

The protocol already defines an allow-listed `Command` type (`agent.task`, `agent.stop`,
`approval.respond`, `cron.pause|resume|run`). Execution will go through the Hermes API
server, which today listens on `127.0.0.1:8642` _inside_ the Hermes container. The plan is
to publish it on the host loopback only (no Tailscale, no public port), keep the API key in
a root-only file on the VPS, and let the relay execute only allow-listed, expiring,
single-use commands. See [ADR 0003](adr/0003-control-plane.md).

## Decisions

- [ADR 0001 — Outbound-only relay on Cloudflare](adr/0001-outbound-only-relay.md)
- [ADR 0002 — Canvas 2D with code-defined sprites](adr/0002-canvas-sprites.md)
- [ADR 0003 — Control plane through the local Hermes API](adr/0003-control-plane.md)
