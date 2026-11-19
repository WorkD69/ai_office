"""CLI: ``python -m ai_office_collector {once,export,project,relay,quota}``."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import signal
import sys
import time
from pathlib import Path

from .config import Config, ConfigError, load_config
from .host import LinuxProbe
from .project import project
from .quota import quota_from_hermes_usage
from .relay import run_relay, validate_url
from .snapshot import build_snapshot, write_atomic

log = logging.getLogger("ai_office_collector")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ai_office_collector", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    once = sub.add_parser("once", help="build one snapshot and print it to stdout")
    once.add_argument("--config", type=Path, required=True)
    once.add_argument("--pretty", action="store_true")

    export = sub.add_parser("export", help="write snapshots periodically (no network needed)")
    export.add_argument("--config", type=Path, required=True)

    proj = sub.add_parser(
        "project", help="isolated mode: project systemd credentials into the exporter input"
    )
    proj.add_argument("--config", type=Path, required=True)
    proj.add_argument(
        "--credentials",
        type=Path,
        default=None,
        help="dir with gateway / cron-<profile> credentials (default: $CREDENTIALS_DIRECTORY)",
    )
    proj.add_argument("--output", type=Path, default=Path("/run/ai-office-metrics"))

    relay = sub.add_parser("relay", help="forward snapshots to the worker over WebSocket")
    relay.add_argument("--snapshot", type=Path, default=Path("/run/agent-office/snapshot.json"))
    relay.add_argument(
        "--allow-insecure", action="store_true", help="allow ws://localhost for local development"
    )

    quota = sub.add_parser(
        "quota", help="convert `hermes usage --json` (stdin) into the quota file"
    )
    quota.add_argument("--output", type=Path, default=Path("/run/agent-office-quota/quota.json"))

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    try:
        if args.cmd == "once":
            config = load_config(args.config)
            snap = build_snapshot(config, LinuxProbe())
            print(json.dumps(snap, ensure_ascii=False, indent=2 if args.pretty else None))
            return 0
        if args.cmd == "export":
            return _export_loop(load_config(args.config))
        if args.cmd == "project":
            return _project(load_config(args.config), args.credentials, args.output)
        if args.cmd == "relay":
            return _relay(args.snapshot, args.allow_insecure)
        if args.cmd == "quota":
            return _quota(args.output)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2
    return 1


def _export_loop(config: Config) -> int:
    stop = False

    def _stop(*_: object) -> None:
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    probe = LinuxProbe()
    out = config.settings.output
    interval = config.settings.interval_seconds
    log.info("exporting every %.0fs to %s", interval, out)
    while not stop:
        started = time.monotonic()
        try:
            write_atomic(out, build_snapshot(config, probe))
        except Exception as exc:
            # Keep running: the previous snapshot stays in place and ages, so the relay
            # stops forwarding it and the office shows the data as stale.
            log.error("export failed: %s", type(exc).__name__)
        time.sleep(max(interval - (time.monotonic() - started), 0.5))
    return 0


def _project(config: Config, credentials: Path | None, output: Path) -> int:
    # Path("") would mean the current directory, so check the raw variable, not the Path.
    env = os.environ.get("CREDENTIALS_DIRECTORY", "")
    directory = credentials or (Path(env) if env else None)
    if directory is None or not directory.is_dir():
        log.error(
            "no credentials directory (run under systemd LoadCredential= or pass --credentials)"
        )
        return 2
    try:
        project(config, directory, output, LinuxProbe())
    except (OSError, ValueError) as exc:
        log.error("projection failed: %s", type(exc).__name__)
        return 1
    return 0


def _quota(output: Path) -> int:
    """Keep the previous file if the fetch failed, so a blip does not blank the meter."""
    try:
        quota = quota_from_hermes_usage(json.loads(sys.stdin.read()))
    except json.JSONDecodeError:
        quota = None
    if quota is None:
        log.error("hermes usage output was unavailable or malformed")
        return 1
    write_atomic(output, quota)
    return 0


def _relay(snapshot: Path, allow_insecure: bool) -> int:
    url = os.environ.get("OFFICE_WORKER_URL", "")
    token = os.environ.get("COLLECTOR_TOKEN", "")
    if not token or len(token) < 32:
        log.error("COLLECTOR_TOKEN must be set (at least 32 characters)")
        return 2
    try:
        url = validate_url(url, allow_insecure)
    except ValueError as exc:
        log.error("%s", exc)
        return 2
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(run_relay(url, token, snapshot))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
