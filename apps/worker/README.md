# @ai-office/worker

Cloudflare Worker that serves the office UI and relays live agent state.

- Serves the built web app (`apps/web/dist`) as static assets with SPA fallback; only `/api/*` runs Worker code.
- Authenticates the owner with Telegram Mini App `initData` and issues a short-lived session token.
- Holds the office state in one Durable Object (`Office`, SQLite-backed) and fans it out to browsers over WebSockets.
- Accepts a single outbound WebSocket from the VPS collector, so the VPS needs no inbound ports.

```
browser / Mini App --(session token)--> /api/ws ----------+
                                                          v
VPS collector --(bearer token, outbound WSS)--> /api/collector --> Durable Object "Office"
                                                          (snapshot -> feed + inbox -> broadcast)
```

The Durable Object uses the WebSocket Hibernation API and no timers, so an idle office costs nothing.
Business logic lives in [`src/core.ts`](src/core.ts) (`OfficeCore`), which has no Cloudflare dependencies and is unit-tested.

## Routes

| Method | Path                 | Auth                                                          | Result                                                                                        |
| ------ | -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/api/health`        | none                                                          | `200 {ok:true}`                                                                               |
| POST   | `/api/auth/telegram` | body `{initData}` from `Telegram.WebApp`                      | `200 {token, expiresAt, role}`, errors below                                                  |
| GET    | `/api/session`       | `Authorization: Bearer <session token>`                       | `200 {expiresAt}` · `401 {error:'invalid_session'}`                                           |
| GET    | `/api/ws`            | session token in `Sec-WebSocket-Protocol: ai-office, <token>` | `101` WebSocket, server sends `{type:'state'}` on connect and on every change · `401` · `426` |
| GET    | `/api/collector`     | `Authorization: Bearer <COLLECTOR_TOKEN>`                     | `101` WebSocket for collector messages · `401` · `426`                                        |
| \*     | `/api/*` (other)     | none                                                          | `404 {error:'not_found'}`                                                                     |
| GET    | everything else      | none                                                          | static web app                                                                                |

The session token is accepted **only** in the subprotocol list or the `Authorization` header, never
in the URL, so it cannot end up in request logs (Workers observability is enabled).

### Login error codes (`POST /api/auth/telegram`)

| Status | `error`             | Meaning / client action                                                           |
| ------ | ------------------- | --------------------------------------------------------------------------------- |
| 400    | `bad_request`       | body or `initData` malformed                                                      |
| 401    | `init_data_expired` | signature valid but `auth_date` older than 1 hour: ask the user to reopen the app |
| 401    | `invalid_signature` | not signed by the bot token (or `auth_date` in the future)                        |
| 403    | `not_owner`         | valid Telegram user, but not `OWNER_TELEGRAM_ID`                                  |
| 413    | `payload_too_large` | body over 8 KB                                                                    |
| 503    | `not_configured`    | a secret is missing or too short (see below)                                      |

### WebSocket close codes

| Code | Sent to   | Meaning                                                                           |
| ---- | --------- | --------------------------------------------------------------------------------- |
| 4401 | viewer    | the session the socket was opened with expired; re-authenticate                   |
| 4409 | collector | replaced by a newer collector connection; back off before reconnecting            |
| 1008 | collector | three invalid messages in a row (the Worker logs schema paths only, never values) |
| 1009 | collector | message larger than 256 KB                                                        |

A browser cannot see the HTTP status of a rejected upgrade (it only gets close code `1006`), so the
web client calls `GET /api/session` to tell an expired session from a network failure.

### Notes and limitations

- Sessions last 12 h and are bound to the current owner id: changing `OWNER_TELEGRAM_ID` or
  `SESSION_SECRET` revokes them. Open sockets are closed with `4401` once their session expires;
  the check runs lazily (on the next broadcast or viewer message) because timers would prevent
  hibernation.
- Viewer sockets are read-only: messages from browsers are ignored, there is no command path yet.
- The `viewer` role exists in the token format but is reserved for future read-only share links and
  is rejected today; only `owner` sessions are issued.
- **The newest collector wins.** A new authenticated collector connection replaces the old one
  (`4409`), so two holders of the same token would evict each other.
- Unchanged snapshots are not re-persisted more often than every 60 s. "Unchanged" ignores
  `generatedAt`, `quota.observedAt` and host-metric noise (RAM rounded to 32 MB, load to 0.25,
  disk to 1 %).
- Only full `state` messages are broadcast; the protocol's `event` message type is reserved.

## Secrets

Set with `wrangler secret put <NAME>`; never committed.

| Name                | Purpose                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `BOT_TOKEN`         | Token of the Mini App bot, used only to verify `initData` signatures |
| `OWNER_TELEGRAM_ID` | Numeric Telegram user id allowed to open the office                  |
| `COLLECTOR_TOKEN`   | Bearer token of the VPS collector, **at least 32 characters**        |
| `SESSION_SECRET`    | HMAC key for session tokens, **at least 32 characters**              |

If a secret is missing or shorter than 32 characters the affected routes answer
`503 {error:'not_configured'}` and the Worker logs the secret's name (never its value).

Generate random values with e.g. `openssl rand -base64 48 | tr '+/' '-_' | tr -d '='`.

## Local development

```sh
cp .dev.vars.example .dev.vars        # fill in test values
npm run build -w @ai-office/web       # the Worker serves ../web/dist
npx wrangler dev                      # from apps/worker
```

## Tests

```sh
npm test -w @ai-office/worker         # vitest, node environment (Web Crypto)
npm run typecheck -w @ai-office/worker
```

`initData` tests build signatures with `node:crypto` as an independent reference implementation.

## Deploy

```sh
npx wrangler login                    # once
npx wrangler secret put BOT_TOKEN
npx wrangler secret put OWNER_TELEGRAM_ID
npx wrangler secret put COLLECTOR_TOKEN
npx wrangler secret put SESSION_SECRET
npm run build -w @ai-office/web
npx wrangler deploy                   # from apps/worker
```

## Telegram Mini App setup (BotFather)

1. Open `@BotFather`, choose your office bot (e.g. `@your_office_bot`).
2. `Bot Settings` → `Configure Mini App` → `Enable Mini App` → set the URL to the deployed Worker
   (`https://ai-office.<account>.workers.dev`).
3. Optionally `/setmenubutton` to put an "Office" button in the bot chat.
4. Open the bot and tap the button. Only the account in `OWNER_TELEGRAM_ID` gets a session; any other user gets `403`.
