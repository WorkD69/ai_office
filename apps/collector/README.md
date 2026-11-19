# AI Office collector

Runs on the server next to [Hermes Agent](https://github.com/NousResearch/hermes-agent)
and feeds the office with a **sanitised, read-only** status snapshot. No inbound port is opened.

```
 Hermes data (read-only)            /run/agent-office/               Cloudflare
 gateway_state.json  ─┐                                               worker
 <profile>/state.db  ─┼─► exporter ─► snapshot.json ─► relay ──wss──►  /api/collector
 <profile>/cron/...  ─┘   no network    (0644)          no Hermes
 systemctl is-active ─┘   DAC_READ_SEARCH only          access
 hermes usage --json ─► quota-probe (timer, root) ─► /run/agent-office-quota/quota.json
```

Privileges are split on purpose:

| Process | Can read Hermes data | Network | Runs as |
|---|---|---|---|
| `exporter` | yes (via `CAP_DAC_READ_SEARCH`; filesystem allow-list: everything under /opt, /var, /srv is hidden except the Hermes data dir, known secrets are inaccessible) | **none** (`PrivateNetwork=yes`) | `DynamicUser` |
| `relay` | **no** (`InaccessiblePaths`) | outbound only | `DynamicUser`, no capabilities |
| `quota-probe` | no, only runs `hermes usage --json` | none of its own (`PrivateNetwork=yes`; the call runs inside the Hermes container) | root (Docker socket), fixed argv, writes only its own `/run/agent-office-quota` |

So a bug in the code that talks to the internet cannot read Hermes data, and the code that
reads Hermes data cannot reach the internet.

## What leaves the server

Only the fields of the protocol `Snapshot` (`packages/protocol/src/schema.ts`): agent status, a
short activity line, timestamps, model name, today's token counters, cron job names/schedules/last
result, host RAM/disk/load, service up/down and quota percentages.
**Never read or sent**: message texts, prompts, session titles, cron job prompts or scripts, chat/user
ids, plan names. The one free-text field that comes from Hermes (`last_activity_description`, a short
machine-written line) passes through `sanitize.clean_text`: control/bidi characters removed,
secret-, key-, e-mail-, handle-, phone- and id-like strings redacted, length clamped. This is
**best-effort** regex redaction, not a guarantee.

## Status rules

Hermes profiles (`source = "hermes"`), first match wins:

| # | Condition | Status | Activity |
|---|---|---|---|
| 1 | `gateway_state.json` missing, not `running`, or `updated_at` older than 180 s | `offline` | reason |
| 2 | the profile's platform (`telegram` / `<profile>:telegram`) is not `connected` | `error` | `Telegram gateway: <state>` |
| 3 | latest session (ignoring `exclude_sources`) is open and active within 120 s | `working` | `last_activity_description`, else "In a conversation" (session titles are never read) |
| 4 | otherwise | `idle` | — |

Systemd agents (`source = "systemd"`), worst unit wins: `failed` → `error`; anything other than
`active` → `offline`; all `active` → `idle`. A live process says nothing about whether it is
*working*, so bots are never shown as working.

`waiting_you` (approval pending) is **not derived** in this version: Hermes v0.21.6 keeps pending
approvals in memory and `runtime/active_sessions.json` carries no approval state. It will come
from the Hermes API event stream in the control phase.

Usage today = rows of `session_model_usage` whose `last_seen` is after local midnight. A session
spanning midnight is counted fully in the new day — good enough for a quota-oriented meter.

## Why the exporter reads a private copy of `state.db`

A read-only SQLite connection to a WAL database must still create/map the `-shm` file next to
it; without write access there SQLite fails with `SQLITE_READONLY_DIRECTORY`, and `immutable=1`
would hide recent writes that live in the WAL. The exporter therefore copies `state.db`
(only after it changes, i.e. after a checkpoint) and `state.db-wal` into
`/run/agent-office/.work/` (mode 0700, tmpfs) and queries the copy. Hermes is never written to.
Measured on a 1 vCPU / 2 GB VPS: ~0.15 s per snapshot, ~26 MB RSS, ~23 MB tmpfs.

## Usage

```sh
python -m ai_office_collector once   --config config.toml --pretty   # print one snapshot
python -m ai_office_collector export --config config.toml            # loop, writes snapshot.json
OFFICE_WORKER_URL=wss://<worker>/api/collector COLLECTOR_TOKEN=... \
python -m ai_office_collector relay  --snapshot /run/agent-office/snapshot.json
hermes usage --json | python -m ai_office_collector quota --output quota.json
```

Configuration: see [`config.example.toml`](config.example.toml). Deployment: [`DEPLOY.md`](DEPLOY.md).

## Development

```sh
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q                 # synthetic fixtures only, no server data
.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests
UPDATE_GOLDEN=1 .venv/bin/pytest tests/test_snapshot.py   # refresh tests/golden/snapshot.json
```

`tests/golden/snapshot.json` is the cross-language contract: it is also validated against the zod
schema on the TypeScript side.

The exporter is stdlib-only (runs on the system `python3`). Only the relay needs `websockets`.
Commands from the worker are **always rejected** in this version (`relay.ALLOWED_ACTIONS` is empty).
