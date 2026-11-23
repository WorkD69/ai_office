# ai-office

## Project

AI Office — pixel-art office for personal AI agents (Hermes Agent): live status, "needs you" inbox, quota meter.
Telegram Mini App + Cloudflare Worker / Durable Object; Python collector on the VPS pushes snapshots out over an
outbound-only relay. Type: pet, public portfolio repo (github.com/WorkD69/ai_office). Overview for people: `README.md`.

## Map

- `packages/protocol` — the shared contract (zod schemas + TS types, `PROTOCOL_VERSION`). Change it first, then worker, web, collector.
- `apps/worker` — Cloudflare Worker (Hono) + Durable Object "Office", Telegram initData auth, `wrangler.jsonc`.
- `apps/web` — pixel office UI (Vite, canvas sprites), served as Worker static assets.
- `apps/collector` — Python collector: status → exporter → relay; systemd units in `deploy/`, `DEPLOY.md`.
- `docs/architecture.md` — how the system works (read before changing code); `docs/roadmap.md` — phases;
  `docs/adr/` — hard-to-reverse decisions. `SECURITY.md` — threat model and isolation of collector stages.
- `scripts/check.py` — the single check command. `tmp/` — scratch, never committed.

## Workflow

Phases: `grill` → `to-spec` → `to-tickets` (GitHub Issues) → `implement` → `review` → merge.

- Work on a feature branch (`feat/<issue>-<slug>`), open a PR, merge after `scripts/check.py` and CI are green and
  review findings are handled. `main` stays releasable: the collector is deployed only from `main` commits.
- Small concrete edits skip grill/spec, but still go through a branch, checks and a PR.

## Checks

Run `python scripts/check.py` before every commit and before saying "done". It runs what CI runs:

- root: `npm run lint`, `format:check`, `typecheck`, `npm test`, `npm run build -w @ai-office/web`;
- `apps/collector`: `ruff check`, `ruff format --check`, `pytest -q` (uses `apps/collector/.venv` if present);
- gitleaks over everything git would commit.

Red = not done. Fix the code, never the linter config, to make it green.

## Deploy

- Worker: `npm run build -w @ai-office/web`, then `npx wrangler deploy` from `apps/worker`; secrets only via
  `wrangler secret put` (steps: `apps/worker/README.md`).
- Collector on the shared VPS: only through ProjectDeploy, project ID `ai-office`:
  `check ai-office`, then `deploy ai-office --commit <main sha>`. Server details: `CLAUDE.local.md` (local, not in git).
- The owner allowed the agent to run `check`/`deploy` for `ai-office` and to change this project's server-side
  setup without a separate OK each time. Still never weaken the exporter isolation that ProjectDeploy checks, and
  never touch other projects on the VPS.

## Boundaries

- Docs disagree with the code → the code is right: fix the doc or ask.
- Never commit `.env`, `.dev.vars`, real collector configs (`apps/collector/config.toml`), secrets, `tmp/`.
  Fixtures are synthetic. Secrets come from env only and never appear in logs.
- Anything that lets agents act needs an allow-list entry, a test and an ADR update.
- Ask before: deleting data, changing the protocol contract incompatibly, adding a paid service.
