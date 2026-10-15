# AGENTS.md — Linux Panel contributor / AI handoff

**Start here even if you have zero chat history.** Linux Panel is a public, single-admin modular Linux management panel with an optional OAuth-protected MCP endpoint and a separately gated systemd update Broker.

## Read first

1. [Current project/deployment status](docs/PROJECT-STATUS.md) — dated evidence, remaining work, priorities, and caveats.
2. [Cross-conversation handoff Issue #54](https://github.com/Ran-ying/linux-panel/issues/54) — living chronology; latest entry may supersede the static status document.
3. [Broker acceptance/release evidence Issue #35](https://github.com/Ran-ying/linux-panel/issues/35) — CI/QEMU/systemd and production activation, known test limitations.
4. [MCP update execution Issue #23](https://github.com/Ran-ying/linux-panel/issues/23) — historical OAuth scope blocker, trusted-client redesign and live tool discovery verification.
5. [v0.5 release execution plan](docs/V0.5-RELEASE-PLAN.md), [roadmap](docs/roadmap.md), [architecture](docs/architecture.md), [updater](docs/UPDATER.md), [operator deployment gate](docs/PRODUCTION-DEPLOYMENT-GATE.md), [security](docs/security.md) and [threat model](docs/THREAT-MODEL.md).

## Design principles

- The same core ActionEngine serves authenticated Web and, when separately enabled, MCP/OAuth. Modules: `apps/api`, `apps/web`, `core`, `modules`, `extensions/mcp`, `platform`, `scripts`, `deployment`, `tests`.
- **Personal trusted-client model:** OAuth authorizes a client login; every active grant can see all explicitly MCP-exposed read Actions, plus globally enabled update proposal or direct-execute Actions. No per-client/per-read-Action scopes or checkboxes. New enabled Actions become available even to old grants; revoke the whole client or disable the global Action policy to revoke access. The Broker's independent validation remains mandatory.
- The updater accepts pinned `origin/main` Git SHA only, performs unprivileged build and fixed privileged systemd deployment/health/rollback. Never introduce arbitrary privileged command execution or silently give root to Web/MCP.
- **Owner-authorized editable terminal collectors:** Linux business read Actions may define editable shell-command fields, persisted by authenticated Web-admin + CSRF/Origin-protected configuration. Web and MCP share those configured commands. Execution refuses UID 0 and runs under the existing unprivileged service identity with bounded time/output; it never uses the root Broker or sudo. The Action's read classification describes its intended purpose, not an OS sandbox: an administrator's custom command can change data accessible to that service account. Keep private command values out of logs/issues.
- App install, Broker install, Broker activation, MCP policy, OAuth consent and an actual update are distinct. `queued` is **not** `success`; check persisted result, health, rollback and journal.
- The owner prefers trusted personal MCP to be convenient once explicitly delegated; do not add redundant per-update Web approvals on the direct-execute path. In the current trusted-client design OAuth grants authorize whole-client access, not per-tool scopes; enforce the current global MCP policy, explicit registry exposure, live grant revocation and Broker integrity.
- Build/test/fault-inject only on disposable test machines. Do not disrupt other production services. Real host changes need operator approval and verification; a GitHub PR is not a deployment.
- **Owner's disposable/test VPS: optimize for fast iteration.** When the owner identifies the host as a test machine and explicitly prefers speed, use the shortest supported command/workflow. Do **not** repeatedly require provider snapshots, bespoke checksum attestations, duplicate preflights, lengthy defensive wrappers, or multiple handoffs for routine reversible changes. One actionable step and one functional outcome check usually suffice. Preserve essential controls (trusted source, separate Web/root identities, no arbitrary root execution, no leaked secrets, and no deletion of unresolved recovery journals). Treat production/multi-tenant machines separately; explain any extra gate only for a concrete risk. Do not promise work is deployed based only on a PR merge or an accepted update request.
- This repo is public: **no private hostnames/IPs, tokens, OAuth client IDs, passwords, cookies, account state, personal server configurations, or restore secrets** in issues, commits, logs or tests.
- Check current `main`, open issues/PRs and active tool list. Do not assume a previously described tool is still exposed or that old status notes remain accurate. Use small reviewed branches/PRs with CI; report source evidence versus operator-reported evidence separately.

## Agent routing for the next release gates

For coding, repo-wide fixes, installation CLI and CI integration, **prefer Codex Cloud** working in small PRs. For browser-oriented acceptance, cross-app issue/release evidence, and documentation packages, **use ChatGPT Work**. ChatGPT coordinates milestone gates, reviews the exact CI and only performs production MCP deploys under the owner's explicit authorization. The owner is responsible for physical iPhone/Android testing and root-only VPS decisions. No cloud-only screenshot can substitute for actual device QA. Keep the phase checklists and exit criteria in [the v0.5 release plan](docs/V0.5-RELEASE-PLAN.md).

## Mandatory milestone wrap-up and cross-conversation handoff

Before declaring a substantive feature, fix, production incident, deployment or release milestone complete:

1. Re-read current `main`, PR/CI and any production evidence available **in this conversation**. Clearly mark **merged**, **CI passed**, **deployed**, and **verified on production** as different states. Do not infer live actions from GitHub merges or a `queued` receipt.
2. Update [`docs/PROJECT-STATUS.md`](docs/PROJECT-STATUS.md): date and current main SHA, what was fixed and why, linked PR/test results, production version last **observed** (or unknown), outstanding failures, priorities, and concrete next verification steps.
3. Add a **brief dated evidence entry** to [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54), linking any release/feature issue (#23/#35 where appropriate). Do not duplicate a full report in this file.
4. Change `AGENTS.md` **only when enduring architecture, safety boundaries or working protocol changes**. It is the short stable entrypoint, not a chronological log.
5. Do source/document writes via a PR and verify CI, then report whether it actually merged. Production writes require separate operator authorization and explicit observation; never silently update this multi-service host.
6. End the user-facing work with a short summary: **done / evidence / not yet done / next action**. If a write or validation failed, record the limitation and do not claim completion.

This workflow is an **instruction for future contributors**, not an automatic background process; each new conversation must actually perform and confirm the relevant GitHub updates. If a new AI conversation has no prior context, read **this file, project status, Issue #54 and Issue #35**, then inspect live main and current tools before taking action.
