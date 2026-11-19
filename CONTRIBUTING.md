# Contributing

This is a personal project, but issues and pull requests are welcome.

## Workflow

1. `npm install` (Node 20.19+) and, for the collector, a Python 3.11+ virtualenv with
   `pip install -e 'apps/collector[relay,dev]'`.
2. Make the change together with its tests.
3. Before pushing, run what CI runs:

   ```bash
   npm run lint && npm run format:check && npm run typecheck && npm test
   npm run build -w @ai-office/web
   (cd apps/collector && ruff check . && ruff format --check . && pytest -q)
   ```

## Rules of thumb

- `packages/protocol` is the contract. Change it first, then the worker, web client and
  collector; the cross-language contract test must stay green.
- Never commit real data: fixtures are synthetic, real collector configs stay on the server.
- Anything that lets agents act needs an allow-list entry, a test and an ADR update.
