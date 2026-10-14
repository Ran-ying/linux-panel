# v0.5 Updater — Acceptance and Release Gate

**Status: PARTIAL REAL-SYSTEMD ACCEPTANCE PASSED; NOT PRODUCTION RELEASE-READY.** On a disposable GitHub-hosted Ubuntu 24.04 runner, the actual privileged service, restricted account, Git and npm completed invalid SHA rejection, an injected test failure with rollback, and successful retry. Reboot/power loss, concurrent approvals, live OAuth-to-Broker handoff and resource-starvation scenarios remain unverified.

## Scope and hard gates

- Never run the root broker installer on CentOS 7 / systemd 219, or bypass its `>=240` check.
- Use a disposable Ubuntu 24.04 or Debian 12+ VM with a snapshot and a separately pinned throwaway Git remote, not the production hostname or production credentials.
- Install as a local operator after inspecting `install-update-broker.sh`, `update-worker.sh` and systemd units. Preserve Git SHA and CI artifact references for every test.
- Verify the root-owned worker, source pin, trigger directory, `linuxpanel` / `linuxpanel-updater` identities, checkout permissions and systemd sandbox with `systemd-analyze security` and effective unit properties. Reviewing a text unit file alone is insufficient.
- A green GitHub CI, Bash syntax pass, or app-level integration test is **not** equivalent to testing the root broker or rollback.

## Release-gate checks (automated subset passed; remaining cases unverified)

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

## Real systemd acceptance evidence — disposable GitHub-hosted Ubuntu

The dedicated [Broker acceptance workflow](../.github/workflows/broker-acceptance.yml)
runs on an **ephemeral GitHub-hosted** Ubuntu 24.04 runner, refuses self-hosted
runners and pre-existing Linux Panel installations, and does not load operator
credentials. It deliberately leaves Web/MCP deployment gates OFF. A test-only
privileged driver submits fixed markers to the actual root-owned worker and
systemd path unit. The runner's checkout uses a public GitHub origin/main
commit and creates random, throwaway local admin credentials.

On 2026-10-15, the [real staging run](https://github.com/Ran-ying/linux-panel/actions/runs/38646024184)
recorded **success** for the following observed scenarios:

| Observed case | Result in ephemeral runner |
| --- | --- |
| Ubuntu 24.04 / systemd 255, actual unprivileged panel and separate root worker | `--check`, `--apply`, `--verify` pass; worker remains disabled after install |
| Invalid Git SHA via real systemd path watcher | `failed` result; old HEAD and running Web API remain unchanged |
| Controlled npm test failure while deploying exact origin/main | `rolled_back`; prior HEAD, state backup and Web service recovered |
| Second request from the same old SHA | `success`; new HEAD matches target and HTTP probe returns healthy |
| End of transaction | Processing/trigger markers removed |

The real-systemd workflow uncovered missing capability inheritance, a
privilege-switching incompatibility, metadata-preserving backup failures,
inconsistent test result paths, cross-mount atomic-restore issues and immediate
post-start health-check races. Fixes belong to the dedicated fixed
root worker, and must be reviewed again before anyone replaces the
already-installed immutable worker on a VPS.

**Still not proven:** real kernel panic/power-off/reboot behavior, interruption
while npm is modifying dependencies, sustained low-memory behavior,
rollback failure when disk is full, concurrent Web/OAuth approvals,
OAuth client credential revocation during an in-flight update, and
operator recovery from a stranded processing marker. A green hosted
workflow is evidence for the listed cases only, **not** a global
production release signature.

## Automated evidence vs. outstanding real-system acceptance

The repository includes `tests/update-worker-sandbox.test.js`, which runs a
disposable **real local Git remote/checkout** through a test-only transformed
copy of the fixed update worker. Its stub systemctl, npm and curl exercise
successful FF, wrong SHA refusal, build failure, failed HTTP health and failed
rollback-build recording without root or changes to the production worker.

The **rootless** suite only tests simulated control flow. The separate
GitHub-hosted acceptance above now also tests actual systemd, npm and Git on
Ubuntu 24.04. Neither suite simulates an abrupt loss of power or provides
production sign-off. The remaining release-gate cases still require independent
staging evidence.

## Already-installed Broker migration acceptance

A separate operator-only `scripts/upgrade-update-broker.sh` has three
modes, `--check` (read-only), `--apply` (explicit root migration with backup)
and `--verify` (read-only). It fails closed if watcher is enabled/active,
a trigger or processing marker is present, Web gate is enabled, installed
privileged files are symlinks/wrong-owner, or the clean Git main checkout
does not match its pinned cached origin/main.

The ephemeral Ubuntu workflow additionally stages known historical root
worker/unit artifacts, injects one `systemctl daemon-reload` failure after
swapping both files, checks rollback to both historical artifacts and a
still-healthy Web service, and then migrates successfully. This test covers
repeat migration/no-op, source equality and disabled watcher/Web gate.
The production VPS receives **no migration automatically**.

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
