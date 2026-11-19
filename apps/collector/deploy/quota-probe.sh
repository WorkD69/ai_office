#!/bin/sh
# Writes the Codex rate-limit windows to /run/agent-office-quota/quota.json.
# Runs from quota-probe.service, which owns that directory (root-only writer, no other
# process can write there). Fixed argv, no user input. On failure the previous file is kept.
set -eu
CONTAINER="${HERMES_CONTAINER:-hermes-agent}"
OUT="${RUNTIME_DIRECTORY:-/run/agent-office-quota}/quota.json"

docker exec "$CONTAINER" hermes usage --json \
  | /usr/bin/python3 -m ai_office_collector quota --output "$OUT"
