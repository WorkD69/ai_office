# Deploying the collector

Target: Ubuntu 24.04 (systemd 255, Python 3.12) with Hermes Agent in Docker, data in
`/opt/hermes-platform/data`. Nothing in Hermes (compose, config, data) is modified.

## 0. Prerequisites

- The worker is deployed and you have generated a collector token
  (`openssl rand -hex 32`) and stored it as the worker secret `COLLECTOR_TOKEN`.
- `python3.12-venv` is installed (needed for the relay's venv).

## 1. Install files (nothing starts yet)

```sh
scp -r apps/collector root@server:/root/ai-office-collector
ssh root@server 'cd /root/ai-office-collector && sh deploy/install.sh'
```

This creates:

| Path | Purpose |
|---|---|
| `/opt/ai-office/lib/ai_office_collector/` | the package (stdlib only) |
| `/opt/ai-office/venv/` | venv with pinned `websockets` for the relay |
| `/opt/ai-office/quota-probe.sh` | fixed-argv quota probe |
| `/etc/ai-office/collector.toml` | roster + paths (from the example, review it) |
| `/etc/ai-office/relay.env` | `OFFICE_WORKER_URL`, `COLLECTOR_TOKEN` — **0600 root** |
| `/etc/systemd/system/office-*.service`, `quota-probe.*` | units |

## 2. Configure

```sh
nano /etc/ai-office/collector.toml   # roster, timezone
nano /etc/ai-office/relay.env        # wss://<worker>/api/collector + token
```

If you run named Hermes profiles, hide their credentials from the exporter with the drop-in
[`deploy/office-exporter.d/hide-profile-secrets.conf.example`](deploy/office-exporter.d/hide-profile-secrets.conf.example)
(one `.env` + `auth.json` pair per profile). The base unit already hides the default profile's
secrets and everything under `/opt`, `/var`, `/srv` outside the Hermes data dir.

Dry run as an unprivileged user with the same capability the service gets:

```sh
cd /tmp && PYTHONPATH=/opt/ai-office/lib \
  setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs \
  --inh-caps=+dac_read_search --ambient-caps=+dac_read_search \
  --bounding-set=-all,+dac_read_search \
  python3 -m ai_office_collector once --config /etc/ai-office/collector.toml --pretty | head -40
```

## 3. Enable

```sh
sh deploy/install.sh --enable
```

## 4. Verify

```sh
systemctl status office-exporter office-relay quota-probe.timer
journalctl -u office-relay -n 20          # "connected to worker"
ls -la /run/agent-office/                 # snapshot.json 0644, .work/ 0700
systemctl show office-exporter -p MemoryCurrent
systemd-analyze security office-exporter office-relay
# negative checks
sudo -u nobody cat /run/agent-office/.work/*/state.db   # must fail: Permission denied
```

Expected exposure: no new listening sockets (`ss -tlnp` unchanged), exporter has no network,
relay only an outbound TLS connection to Cloudflare.

## Rollback

```sh
systemctl disable --now office-relay office-exporter quota-probe.timer
rm -f /etc/systemd/system/office-exporter.service /etc/systemd/system/office-relay.service \
      /etc/systemd/system/quota-probe.service /etc/systemd/system/quota-probe.timer
systemctl daemon-reload
rm -rf /opt/ai-office /run/agent-office /run/agent-office-quota   # keep /etc/ai-office if you plan to reinstall
```

Hermes keeps running throughout; it is never restarted by these steps.
