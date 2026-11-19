# ADR 0001 — Outbound-only relay on Cloudflare

- Status: accepted
- Date: 2026-11-19

## Context

The agents run on a 1 vCPU / 2 GB VPS that already hosts several services; about
400–900 MB of RAM is free depending on load. Policy for that server: **no inbound ports**.
The UI must work as a Telegram Mini App (public HTTPS required) and in a desktop browser,
and must stay reachable when the VPS or the owner's laptop is down. Budget: free tiers only.

## Options considered

| Option                                                        | Pros                                                                                                            | Cons                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cloudflare Worker + Durable Object, VPS connects out over WSS | No inbound port; state survives VPS outages; WebSocket Hibernation keeps idle cost at zero; free tier is enough | Vendor-specific DO API                                                  |
| `cloudflared` tunnel to a service on the VPS                  | Simple mental model                                                                                             | Public surface lands on the VPS; extra daemon RAM; UI dies with the VPS |
| Tailscale Funnel                                              | Already installed                                                                                               | Beta; public surface on the VPS; `*.ts.net` URL                         |
| Supabase Realtime                                             | Postgres + realtime                                                                                             | Free projects pause after a week of inactivity                          |
| Fly.io                                                        | Full VM                                                                                                         | No free tier for new accounts                                           |

## Decision

Cloudflare Worker (Hono) serving the static UI and API from one origin, plus one SQLite-backed
Durable Object using the WebSocket Hibernation API. The VPS runs a small relay that opens an
**outbound** WebSocket to the Durable Object.

## Consequences

- The VPS never accepts connections; compromise of the Worker cannot reach the VPS except
  through the (future) command channel, which the relay validates independently.
- Free-tier budgets shape the design: the relay sends only when the snapshot changes (volatile
  host metrics are quantised, timestamps ignored) plus heartbeats, and the
  DO avoids writing unchanged snapshots and avoids timers (they prevent hibernation).
- A second implementation (e.g. self-hosted Node server) would only need to speak the same
  `packages/protocol` messages.
