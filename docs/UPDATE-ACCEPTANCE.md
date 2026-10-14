# v0.5 Updater — Acceptance and Release Gate

**Status (2026-10-14): NOT VERIFIED IN PRODUCTION.** This is an operator test plan, not evidence of successful deployment.

## Scope and hard gates

- Never run the root broker installer on CentOS 7 / systemd 219, or bypass its `>=240` check.
- Use a disposable Ubuntu 24.04 or Debian 12+ VM with a snapshot and a separately pinned throwaway Git remote, not the production hostname or production credentials.
- Install as a local operator after inspecting `install-update-broker.sh`, `update-worker.sh` and systemd units. Preserve Git SHA and CI artifact references for every test.
- Verify the root-owned worker, source pin, trigger directory, `linuxpanel` / `linuxpanel-updater` identities, checkout permissions and systemd sandbox with `systemd-analyze security` and effective unit properties. Reviewing a text unit file alone is insufficient.
- A green GitHub CI, Bash syntax pass, or app-level integration test is **not** equivalent to testing the root broker or rollback.

## Required checks (all initially UNVERIFIED)

| Case | Expected result | Evidence to preserve |
|---|---|---|
| Disabled Broker; MCP off | Web status/check work; update request denied | HTTP results; state unchanged |
| MCP off; Broker on | Web request and password approval work | Action/audit entries and exact SHA |
| MCP on without `panel:update` | No MCP update Action | OAuth scopes and MCP tools/list |
| MCP Scope granted then revoked | Future MCP calls denied | New tools/call rejection |
| Target SHA invalid or non-main | Denied before deployment; no unexpected checkout changes | HTTP, worker log, Git SHA |
| Correct SHA, first-run install | Source pin and working tree permissions verified | `stat`, `systemctl show` |
| Web approval with missing CSRF | Denied; no marker | HTTP response; trigger absent |
| Wrong password or reused TOTP | Denied; no marker | HTTP; audit |
| Two simultaneous approvals | At most one marker / one broker invocation | Audit, trigger and service journal |
| Concurrent update proposals | Only one live proposal accepted | HTTP 200/409, state |
| Cancel unapproved request | No subsequent approval possible | HTTP 409, audit |
| Finished broker result | No stale “queued” UI; new proposal possible | Result ID and status Action |
| Git fetch/auth failure | No update; app remains available | Git HEAD, health and log |
| `npm ci` or test failure | Rollback attempted and recorded accurately | Old SHA, dependency tree, logs |
| Web build failure | Rollback attempted and recorded accurately | Old assets and service health |
| Service start or health failure | Rollback attempted; warn if rollback also fails | old/new SHA, systemd, HTTP |
| Rollback itself fails | Explicit failure and manual recovery instructions | `failed` result and root journal |
| Power failure mid-update | Recovery path documented; no silent success | Snapshot restore rehearsal |

## Evidence and sign-off

For each case record OS version, `systemctl --version`, initial/final full Git SHAs,
time-stamped commands and outputs, process UIDs, app/Broker journal excerpts,
HTTP response, state file/backup permissions, remaining disk capacity and recovery outcome.
Redact cookies, passwords, tokens, recovery codes, private keys and private host identifiers.

Do not mark release-ready until the supported staging VM has passed the positive and failure-injection scenarios, followed by a separate security review of root-sandbox effective properties and update-source trust. Production migration or installer execution requires explicit operator approval.

## Current production VPS

CentOS 7 has insufficient systemd sandbox capability for this broker. Its other services must remain untouched. Keep the current read-only MCP service and app available; do not interpret v0.5 GitHub code merges as deployment.
