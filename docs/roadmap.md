# Roadmap

| Phase | Scope                                                                                                                                                | Status      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1     | Monorepo, shared protocol, Worker + Durable Object with Telegram auth, pixel office with demo mode, collector with tests, CI                         | in progress |
| 2     | Deploy the collector on the VPS (exporter + relay), live statuses, cron jobs, host metrics, quota meter                                              | planned     |
| 3     | Control: give a task, stop a run, approve/deny, pause/resume/run cron — via the Hermes API on host loopback ([ADR 0003](adr/0003-control-plane.md))  | planned     |
| 4     | Dev room (Claude Code hooks from the laptop), watchdog and archivist scripts, quota governor (pause background jobs above thresholds), notifications | planned     |
| 5     | Content team pilot with measured quota cost, read-only share links for viewers, room editor                                                          | idea        |

Guiding rule: deterministic scripts watch, the LLM is called only where a decision is needed,
and the owner approves anything with external effects.
