# v0.5 Updater — Acceptance and Release Gate

**Status: NOT VERIFIED FOR LIVE ROOT BROKER.** Rootless Git worker simulations and app/OAuth tests have passed in CI, but there is no disposable VM sign-off for the real systemd broker, service interruption, power loss or rollback.

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
| MCP direct policy enabled but Broker inactive | Direct execution scope unavailable; no marker created | Effective env flag, scopes/consent, state unchanged |
| MCP direct scope absent or only `panel:update` | Direct Action unavailable and calls denied | OAuth tools/list and tools/call |
| MCP direct scope explicitly consented, Broker active | Exactly one pinned SHA enqueued; separately confirm worker result | Full tool receipt, marker identity, journal, resulting Git SHA |
| MCP direct policy/grant revoked | New executions refused immediately; old tokens cannot upgrade | Scope policy and actual call responses |
| MCP direct queue busy or trigger inaccessible | No queued-success response; no stale approved record | State and trigger ownership, audit entries |
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

## Automated evidence vs. outstanding real-system acceptance

The repository includes `tests/update-worker-sandbox.test.js`, which runs a
disposable **real local Git remote/checkout** through a test-only transformed
copy of the fixed update worker. Its stub systemctl, npm and curl exercise
successful FF, wrong SHA refusal, build failure, failed HTTP health and failed
rollback-build recording without root or changes to the production worker.

This tests the worker's control flow, **not** npm's actual resource use,
systemd sandbox user switching, process lifetime across machine power loss,
worker/service concurrent writers, rollback following ungraceful kernel restart,
or origin TLS. The acceptance matrix below and external disposable Ubuntu
24.04/Debian 12+ VM sign-off remain required for production activation.

## Installation gate and operational sign-off

The one-time Broker installer now has four explicit modes. Operators must
capture evidence from each distinct stage, not infer success from a green CI.

| Stage | Command | What is proven | What is **not** proven |
| --- | --- | --- | --- |
| Preflight | `sudo bash scripts/install-update-broker.sh --check` | Required OS, paths, disk, identities and checkout constraints | No code has been changed; no root worker is tested |
| Install | `sudo bash scripts/install-update-broker.sh --apply` | Worker/unit/pin copied and source ownership changed | Watcher and Web update permission remain OFF |
| Verify | `sudo bash scripts/install-update-broker.sh --verify` | Read-only checks of ownership, source pin and effective hardening | Real Git/npm/update/rollback paths remain unverified |
| Activate | `sudo bash scripts/install-update-broker.sh --activate --ack-acceptance` | Operator attests **separate staging sign-off** and opts in | An automatically successful rollout is **not** implied |

Never run failure injection (especially shutdowns, faulty Git commits,
service-failure or deliberate rollback errors) against a shared live VPS.
Keep screenshots and private hostnames/credentials out of the public project.
The self-attestation flag does not perform staging tests and is not a
security certification.

## Current production VPS

CentOS 7 has insufficient systemd sandbox capability for this broker. Its other services must remain untouched. Keep the current read-only MCP service and app available; do not interpret v0.5 GitHub code merges as deployment.
