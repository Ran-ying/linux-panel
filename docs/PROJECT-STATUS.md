# Linux Panel — current project status and handoff

**As of 2026-10-15.** Check the current GitHub `main`, latest CI/PRs and [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54) before treating this as current. Do not commit live service credentials, OAuth IDs or identifying infrastructure information to this public repository.

## Product and architecture
Fastify/Node 24 + Vue 3 modular Linux administration panel. A shared ActionEngine exposes authenticated Web actions and a configurable MCP Streamable HTTP adapter with OAuth Authorization Code + PKCE, per-client grants and live allowlists. The independent, fixed systemd update Broker uses a root-owned immutable worker and recovery guard, `linuxpanel-updater` for Git/npm, pinned `origin/main` SHA-only fast-forward, fsynced recovery journal, private-state backup, health verification and rollback. TOTP is optional. It does **not** provide general root shell or arbitrary external deployments.

Primary directories: `apps/api/`, `apps/web/`, `core/`, `modules/`, `extensions/mcp/`, `platform/`, `scripts/`, `deployment/`, `tests/`. The old [roadmap](roadmap.md) describes goals, not necessarily current operational status; review evidence below.

## Latest verified development milestone (historical SHA)
- GitHub `main` snapshot: `6fe0e8465157132f3a79d03e64b2057d6a1a8c23`.
- Normal CI, disposable Ubuntu 24.04 actual systemd Web/MCP update paths, constrained real npm builds under a 768MiB cgroup and isolated QEMU root-worker hard-power-loss recovery passed. The QEMU cut uses an npm pause and HTTP fixture; the actual npm build is tested separately. Other failure boundaries are not exhaustively tested.
- Source/evidence: [Issue #35](https://github.com/Ran-ying/linux-panel/issues/35), [PR #48](https://github.com/Ran-ying/linux-panel/pull/48), [PR #50](https://github.com/Ran-ying/linux-panel/pull/50), [PR #51](https://github.com/Ran-ying/linux-panel/pull/51), [PR #52](https://github.com/Ran-ying/linux-panel/pull/52), [PR #53](https://github.com/Ran-ying/linux-panel/pull/53).

## Actual production observation (owner-provided SSH logs; not a live direct-write verification)
On 2026-10-15, the operator checked out the audited `main` snapshot, ran root Broker migration/verification, then separately **authorized and ran** `install-update-broker.sh --activate --ack-acceptance`. Logs establish:
- Migration verify: `0 BLOCK / 0 WARN`.
- Installed Broker verify: `0 BLOCK / 2 WARN` (under *recommended* disk and MemAvailable+SwapFree budgets; enforceable safety thresholds passed).
- `linux-panel-update.path`: enabled, active; `linux-panel-update-recover.service`: enabled; `linux-panel.service`: active.
- Local authenticated-status health endpoint returned JSON `{"initialized":true}`. No update was requested as part of activation.
- Production **deployment mechanism is enabled**, not an automatic periodic updater, and no new SHA or live post-activation update transaction has been observed. Backup/snapshot recovery remains operator evidence, not independently confirmed. Do not publish target host/domain/IP here.

Read [operator deployment and recovery gate](PRODUCTION-DEPLOYMENT-GATE.md) before any future production changes; the server also hosts unrelated services. The Linux Panel MCP connector in ChatGPT may be **read-only plus proposal**, not a privileged deployment interface.

## Current OAuth / MCP blocker (owner's Web observations on 2026-10-15)
- Owner reported the global MCP policy, update proposals and direct execution toggle switched on and saved, plus read-only allowlist including `panel.update.status`.
- But the **ChatGPT OAuth grant** displayed in the Web client list has `system:read`, `services:read`, `storage:read`, `panel:update` **only**. Missing `panel:read` and `panel:update:execute`.
- Tool inventory in the user's active ChatGPT conversation exposes `panel_update_request`, `system_info`, `system_memory`, `system_cpu`, `services_list`, `storage_usage`; it does not expose `panel_update_status` or `panel_update_execute`.
- `extensions/mcp/index.js` registers direct execution only if the tool registry is configured, `PANEL_UPDATER_ENABLED=1`, active policy allows direct updates **and** live scope includes `panel:update:execute`; `oauth-store.js` prevents expanding existing grants via the shrink-only grant-management route.
- **Diagnosis:** global allowlist does not expand existing client OAuth rights. To make direct execution available, the client must actually request `panel:update:execute` in a *new consent* and potentially request `panel:read`; verify authorization display and a fresh `tools/list`. It is **not yet proven** the currently installed ChatGPT connection can request these scopes simply by reconnecting. Investigate OAuth request/default-scope negotiation, authorization, and client integration before promising an automatic fix.
- Preserve the user's chosen personal-AI trust model: once they deliberately delegate direct OAuth execution, avoid redundant per-update Web password/TOTP prompts, while retaining the independently verified Broker restrictions and revocation.

## Prioritized remaining work
1. **OAuth scope upgrade / user-visible connection flow** ([Issue #23](https://github.com/Ran-ying/linux-panel/issues/23)): reproduce and document the actual OAuth request scopes; get a new explicitly consented grant; check current tool list and test the read-only status action first. Do not infer rights from checkboxes.
2. **Operational acceptance and production update result** ([Issue #35](https://github.com/Ran-ying/linux-panel/issues/35)): snapshot/independent console, safety-budget review, and a *genuine reviewed new* main commit as update target; observe result, HTTP health and recovery. Avoid fake commits/downgrades and any shared-host failure injection.
3. **v0.5 release hygiene:** synchronize README/roadmap wording with evidence; close or revise Issues #14, #22, #23, #35 only on their respective acceptance criteria. Installation UX and CentOS 7 support are distinct questions; do not bypass systemd >=240 protections.
4. **v0.6 plan:** restricted operations Broker with narrowly scoped actions, authorizations, audit, safe rollback. **v1.0:** clean-instance install/upgrade/restore testing, documentation and independent security review.

## Continuity for an assistant without chat context
1. Read [`AGENTS.md`](../AGENTS.md), this document and [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54).
2. Query live `main`, CI, Issues #23/#35, PRs and currently exposed MCP tools before acting. User-specific connection state can differ across conversations.
3. Work via small GitHub branches/PRs with tests; keep source writes separate from the actual production deployment.
4. After every significant change, date and update this status document + the living Issue #54. Mark unknowns explicitly.
