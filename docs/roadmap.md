# Roadmap

Office v2 replaces the old phase plan. Product spec: [spec.md](spec.md); technical design:
[specs/office-v2-tech.md](specs/office-v2-tech.md).

| Stage | Scope                                                                                                                                                                                                                                              | Status      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| v1    | Monorepo, shared protocol, Worker + Durable Object with Telegram auth, pixel office with demo mode, collector on the VPS (exporter + relay), live statuses, cron jobs, host metrics, quota meter                                                   | done        |
| 1     | Clear office: protocol v2 (feed and "needs you" as codes, texts in Russian, quotas list, agent card fields), phone layout with bottom tabs, status badges, "Services" room, agent card with "open chat", laptop layout, Telegram Login on the site | in progress |
| 2     | Link with projects: Hermes profiles picked up automatically, agent passports in this repo, "Newcomers" room, harness rule "new agent or bot -> passport"                                                                                           | planned     |
| 3     | Claude quota from the laptop and owner notifications through the office bot (agent offline, quota above 90 %, collector silent)                                                                                                                    | planned     |
| later | Control buttons (run now, pause a schedule, approve/deny), access for a friend, helper agents, quota governor                                                                                                                                      | idea        |

Stage 1 tickets: GitHub issues #2–#10. After stage 1 the owner decides whether stages 2 and 3 are
still needed in this form.

The old phases 3–5 are cancelled. Until control comes back, tasks are given to agents in their own
Telegram chats and the office links there; the allow-listed `Command` type stays in the protocol
unused, and [ADR 0003](adr/0003-control-plane.md) keeps its constraints for that return. Not
planned at all: the dev room for Claude Code sessions (the Pixel Agents extension covers it).

Guiding rule: deterministic scripts watch, the LLM is called only where a decision is needed,
and the owner approves anything with external effects.
