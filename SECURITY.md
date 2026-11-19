# Security

AI Office shows (and, later, controls) personal AI agents, so the design is deliberately
conservative. This document lists the threat model and the controls in place.

## Reporting

Please open a private security advisory on GitHub rather than a public issue.

## What is protected

- Agent conversations, prompts and personal data on the VPS.
- Credentials: Telegram bot tokens, model-provider OAuth tokens, the Hermes API key.
- The ability to make agents act (phase 3).

## Controls

| Area                       | Control                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network                    | The VPS accepts **no inbound connections** for the office. The relay connects out over TLS (certificate verified).                                                                                                                                                                                                                                          |
| Least privilege on the VPS | The exporter runs with `PrivateNetwork=yes` (no network at all), sees only an allow-listed part of the filesystem and never writes to Hermes data; the relay runs as a capability-less `DynamicUser` that cannot read Hermes data at all. Neither gets the Docker socket; the optional quota probe is a separate, sandboxed root unit with a fixed command. |
| Data minimisation          | The exporter never reads message bodies or prompts and never emits chat/user ids. The only free text (an agent's short activity line) is truncated and passed through a best-effort regex sanitiser that redacts token-, key-, id- and contact-like strings.                                                                                                |
| Owner authentication       | Telegram Mini App `initData` is verified server-side (HMAC-SHA256, constant-time compare, `auth_date` freshness) and must belong to the configured owner id. The worker then issues a signed 12 h session token; open sockets are closed when it expires (`4401`).                                                                                          |
| Collector authentication   | Bearer token (≥ 32 chars) compared in constant time; at most one collector socket is open — a newer connection replaces the older one (`4409`).                                                                                                                                                                                                             |
| Input validation           | Every message crossing a trust boundary is parsed with the shared zod schemas and size-limited.                                                                                                                                                                                                                                                             |
| Secrets                    | Only in Cloudflare secrets and root-only files on the VPS. Nothing secret is bundled into the frontend. CI runs gitleaks on every push.                                                                                                                                                                                                                     |
| Public visitors            | Outside Telegram the web app runs a synthetic demo; real data requires owner authentication.                                                                                                                                                                                                                                                                |
| Control plane (phase 3)    | Allow-listed actions only, expiring single-use command ids, audit log, independent validation on the VPS; Hermes API bound to host loopback only. See [ADR 0003](docs/adr/0003-control-plane.md).                                                                                                                                                           |

## Known limitations

- The Hermes API key has full access (no read-only scope exists), which is why phase 1–2 use
  files only.
- Desktop browser login (outside Telegram) is not implemented yet; use Telegram Desktop.
