#!/bin/sh
# Idempotent installer for the AI Office collector. Run as root from apps/collector:
#   sudo sh deploy/install.sh                       # install / update files only
#   sudo sh deploy/install.sh --enable              # ...and enable + (re)start the services
#   sudo sh deploy/install.sh --enable --with-quota # ...plus the optional root quota probe
#
# Installs the isolated mode (office-status projection + exporter + relay). The full mode
# exporter in deploy/full-mode/ is not installed by this script; see DEPLOY.md.
#
# It never touches Hermes, its compose project or its data. Re-running only replaces
# the collector's own files; existing /etc/ai-office/*.toml|env are kept.
set -eu

ENABLE=0
QUOTA=0
for arg in "$@"; do
  case "$arg" in
    --enable) ENABLE=1 ;;
    --with-quota) QUOTA=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
cd "$(dirname "$0")/.."

PREFIX=/opt/ai-office
ETC=/etc/ai-office
UNITS=/etc/systemd/system

echo "==> system user for the projection (its preserved /run output must stay readable)"
for user in ai-office-status; do
  id "$user" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$user"
done

echo "==> package -> $PREFIX/lib"
install -d -m 0755 "$PREFIX" "$PREFIX/lib"
rm -rf "$PREFIX/lib/ai_office_collector.new"
cp -r src/ai_office_collector "$PREFIX/lib/ai_office_collector.new"
find "$PREFIX/lib/ai_office_collector.new" -name '__pycache__' -prune -exec rm -rf {} +
rm -rf "$PREFIX/lib/ai_office_collector"
mv "$PREFIX/lib/ai_office_collector.new" "$PREFIX/lib/ai_office_collector"
chmod -R u=rwX,go=rX "$PREFIX/lib"
install -m 0755 deploy/quota-probe.sh "$PREFIX/quota-probe.sh"

echo "==> venv for the relay ($PREFIX/venv, deploy/requirements-relay.txt)"
if [ ! -x "$PREFIX/venv/bin/python" ]; then
  python3 -m venv "$PREFIX/venv"
fi
# Hash-pinned and binary-only: no code from an sdist build runs as root.
"$PREFIX/venv/bin/python" -m pip install --quiet --disable-pip-version-check \
  --require-hashes --only-binary=:all: -r deploy/requirements-relay.txt

echo "==> config in $ETC (kept if present)"
install -d -m 0755 "$ETC"
if [ ! -f "$ETC/collector.toml" ]; then
  install -m 0644 config.example.toml "$ETC/collector.toml"
  echo "    created $ETC/collector.toml from the example - review the roster"
fi
if [ ! -f "$ETC/relay.env" ]; then
  umask 077
  cat > "$ETC/relay.env" <<'EOF'
# Filled in by the owner. Never commit this file.
OFFICE_WORKER_URL=wss://CHANGE-ME.workers.dev/api/collector
COLLECTOR_TOKEN=
# Optional: source IPv4 for the outbound connection (e.g. when a VPN changes the default route).
# OFFICE_EGRESS_IPV4=
EOF
  echo "    created $ETC/relay.env (0600) - set OFFICE_WORKER_URL and COLLECTOR_TOKEN"
fi
chmod 0600 "$ETC/relay.env"

echo "==> systemd units"
for unit in office-status.service office-status.timer office-exporter.service office-relay.service \
  quota-probe.service quota-probe.timer; do
  install -m 0644 "deploy/$unit" "$UNITS/$unit"
done
systemctl daemon-reload
for unit in office-status.service office-exporter.service office-relay.service quota-probe.service; do
  systemd-analyze verify "$UNITS/$unit" >/dev/null 2>&1 || echo "    WARN: systemd-analyze verify $unit reported issues"
done

echo "==> self-check: the installed package imports"
PYTHONPATH="$PREFIX/lib" python3 -c "import ai_office_collector, sys; print('    ok, version', ai_office_collector.__version__)"

if [ "$ENABLE" -eq 1 ]; then
  echo "==> enabling services"
  systemctl enable --now office-status.timer
  systemctl start office-status.service
  # restart, not just enable --now: an already running exporter would keep the old code
  # (e.g. writing old-protocol snapshots that the new relay drops).
  systemctl enable office-exporter.service
  systemctl restart office-exporter.service
  if [ "$QUOTA" -eq 1 ]; then
    systemctl enable --now quota-probe.timer
  fi
  if grep -q '^COLLECTOR_TOKEN=.\{32,\}' "$ETC/relay.env"; then
    systemctl enable office-relay.service
    systemctl restart office-relay.service
  else
    echo "    relay NOT started: COLLECTOR_TOKEN is not set in $ETC/relay.env"
  fi
  systemctl --no-pager --lines=0 status office-exporter.service office-relay.service || true
else
  echo "Files installed. Nothing was started. Re-run with --enable when ready."
fi
