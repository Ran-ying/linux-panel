# AGENTS.md — Linux Panel contributor / AI handoff

**Start here even if you have zero chat history.** Linux Panel is a public, single-admin modular Linux management panel with an optional OAuth-protected MCP endpoint and a separately gated systemd update Broker.

## Read first

1. [Current project/deployment status](docs/PROJECT-STATUS.md) — dated evidence, remaining work, priorities, and caveats.
2. [Cross-conversation handoff Issue #54](https://github.com/Ran-ying/linux-panel/issues/54) — living chronology; latest entry may supersede the static status document.
3. [Broker acceptance/release evidence Issue #35](https://github.com/Ran-ying/linux-panel/issues/35) — CI/QEMU/systemd and production activation, known test limitations.
4. [Direct MCP execution Issue #23](https://github.com/Ran-ying/linux-panel/issues/23) — scope gating and current client authorization gap.
5. [Architecture](docs/architecture.md), [updater](docs/UPDATER.md), [operator deployment gate](docs/PRODUCTION-DEPLOYMENT-GATE.md), [security](docs/security.md), [threat model](docs/THREAT-MODEL.md), [roadmap](docs/roadmap.md).

## Design principles

- The same core ActionEngine serves authenticated Web and, when separately enabled, MCP/OAuth. Modules: `apps/api`, `apps/web`, `core`, `modules`, `extensions/mcp`, `platform`, `scripts`, `deployment`, `tests`.
- OAuth grant scopes, current server policy and action exposure must **all** permit an MCP action. Read-only MCP actions differ from update proposals (`panel:update`) and from direct enqueue (`panel:update:execute`). An old scope grant never silently upgrades.
- The updater accepts pinned `origin/main` Git SHA only, performs unprivileged build and fixed privileged systemd deployment/health/rollback. Never introduce arbitrary command execution or silently give root to Web/MCP.
- App install, Broker install, Broker activation, MCP policy, OAuth consent and an actual update are distinct. `queued` is **not** `success`; check persisted result, health, rollback and journal.
- The owner prefers trusted personal MCP to be convenient once explicitly delegated; do not add redundant per-update Web approvals on the direct-execute path. Still honor actual OAuth scopes, allowlists and Broker integrity.
- Build/test/fault-inject only on disposable test machines. Do not disrupt other production services. Real host changes need operator approval and verification; a GitHub PR is not a deployment.
- This repo is public: **no private hostnames/IPs, tokens, OAuth client IDs, passwords, cookies, account state, personal server configurations, or restore secrets** in issues, commits, logs or tests.
- Check current `main`, open issues/PRs and active tool list. Do not assume a previously described tool is still exposed or that old status notes remain accurate. Use small reviewed branches/PRs with CI; report source evidence versus operator-reported evidence separately.

## Operational handoff habit

At a meaningful milestone update `docs/PROJECT-STATUS.md` (dated), append to Issue #54, and link specific proof in the relevant feature/release issue. Do not close a release gate based only on automated tests. If a new AI conversation has no context, instruct it to read **this file, project status, Issue #54 and Issue #35** first.
