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
| `/etc/systemd/system/office-*.{service,timer}`, `quota-probe.*` | units (isolated mode; quota probe only enabled with `--with-quota`) |

## 2. Configure

```sh
nano /etc/ai-office/collector.toml   # roster, timezone
nano /etc/ai-office/relay.env        # wss://<worker>/api/collector + token
```

Hand each Hermes profile's cron jobs to the projection with the drop-in
[`deploy/office-status.d/hermes-profiles.conf.example`](deploy/office-status.d/hermes-profiles.conf.example)
(one `LoadCredential=cron-<profile>:...` line per profile whose `cron/jobs.json` exists).
`gateway_state.json` is already loaded by the base unit.

Dry run of the projection and one snapshot (isolated mode needs no capabilities):

```sh
systemctl start office-status.service && ls -la /run/ai-office-metrics
PYTHONPATH=/opt/ai-office/lib python3 -m ai_office_collector once   --config /etc/ai-office/collector.toml --pretty | head -40   # reads the projection only
```

## 3. Enable

```sh
sh deploy/install.sh --enable
```

## 4. Verify

```sh
systemctl status office-status.timer office-exporter office-relay
journalctl -u office-relay -n 20          # "connected to worker"
ls -la /run/agent-office/ /run/ai-office-metrics/   # snapshot.json and projection, 0644
systemctl show office-exporter -p MemoryCurrent
systemd-analyze security office-exporter office-relay
# negative checks
systemctl show office-exporter -p InaccessiblePaths    # /opt/hermes-platform is listed
cat /proc/$(systemctl show -p MainPID --value office-exporter)/net/dev   # only lo
```

Expected exposure: no new listening sockets (`ss -tlnp` unchanged), exporter has no network,
relay only an outbound TLS connection to Cloudflare.

## Rollback

```sh
systemctl disable --now office-relay office-exporter office-status.timer quota-probe.timer
rm -f /etc/systemd/system/office-exporter.service /etc/systemd/system/office-relay.service \n      /etc/systemd/system/office-status.service /etc/systemd/system/office-status.timer \
      /etc/systemd/system/quota-probe.service /etc/systemd/system/quota-probe.timer
systemctl daemon-reload
rm -rf /opt/ai-office /run/agent-office /run/ai-office-metrics /run/agent-office-quota   # keep /etc/ai-office if you plan to reinstall
```

Hermes keeps running throughout; it is never restarted by these steps.

## Session projection (optional, recommended over full mode)

Adds the `working` status, the activity line and today's token usage while the exporter
stays isolated: install
[`deploy/office-status.d/session-projection.conf.example`](deploy/office-status.d/session-projection.conf.example)
as a drop-in for `office-status.service` and set `session_source` and `work_dir` in
`collector.toml` (see the comments in both files).

## Full mode (optional)

Full mode adds the `working` status and today's token usage by letting the exporter read a
private copy of each profile's `state.db`. It needs `CAP_DAC_READ_SEARCH`, so it is opt-in:

```sh
install -m 0644 deploy/full-mode/office-exporter.service /etc/systemd/system/
install -d /etc/systemd/system/office-exporter.service.d
cp deploy/full-mode/hide-profile-secrets.conf.example    /etc/systemd/system/office-exporter.service.d/hide-profile-secrets.conf   # edit profiles
# collector.toml: hermes_home = "/opt/hermes-platform/data", read_session_state = true,
#                 work_dir = "/run/agent-office/.work"
systemctl daemon-reload && systemctl restart office-exporter
```

## Egress through a specific address

If a VPN or policy routing changes the default route, set `OFFICE_EGRESS_IPV4=<host IPv4>` in
`/etc/ai-office/relay.env`; the relay binds its outbound socket to that address.
