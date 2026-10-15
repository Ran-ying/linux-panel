# v0.5 Updater — Acceptance and Release Gate

**Status: PARTIAL REAL-SYSTEMD ACCEPTANCE PASSED; NOT PRODUCTION RELEASE-READY.** On a disposable GitHub-hosted Ubuntu 24.04 runner, the actual privileged service, restricted account, Git and npm completed invalid SHA rejection, an injected test failure with rollback, and successful retry. SIGKILL recovery and both Web/MCP valid-SHA deployment paths have now passed in isolated runners. Literal hard-power-loss integrity, concurrent approvals, and resource-starvation scenarios remain unverified.

## Real Web, PKCE OAuth and MCP-to-Broker integration (staging only)

The [disposable real Ubuntu workflow](../.github/workflows/broker-acceptance.yml)
runs `tests/staging/web-mcp-broker.mjs` after real Git/npm/systemd failure
and SIGKILL recovery cases, with separate fresh `web` and `mcp` matrix runners.
Each uses an ephemeral localhost Web account with a random password;
no production domains, tokens or data are used.

The root runner **temporarily** enables `PANEL_UPDATER_ENABLED=1` only inside
the isolated test VM and keeps the real systemd Broker watcher active. It tests:

- Web login, Origin and CSRF, real `panel.update.request` and password
  `/api/panel/update/approve` (invalid password and missing CSRF are denied).
- A deliberately non-main SHA is queued through Web, rejected by the **actual
  root systemd Broker**, and reported as `failed` by authenticated Web status.
- Dynamic OAuth client registration, displayed user consent, authorization
  code + PKCE S256 token exchange, and absence of direct-update rights when
  OAuth scope was omitted.
- Separate explicitly consented `panel:update:execute` grant; a real HTTP
  `tools/call` queues another deliberately invalid SHA, which is denied by
  the fixed Broker. An independent `panel:read` grant reads the exact
  result; the returned `queued` receipt is not mistaken for deployment success.
- The isolated `web` scenario approves a **valid** pinned `origin/main`
  SHA with the real password step-up; the isolated `mcp` scenario submits
  the same valid SHA via independently consented `panel:update:execute`.
  Both require actual root `success`, updated checkout HEAD and Web
  `panel.update.check`, and reconnect existing Web/OAuth sessions across
  the service restart. A pre-update `panel:read` token observes the exact
  completed result after redeployment.
- Turning off `allowDirectUpdates` hides the execution tool for an old
  bearer; revoking its grant makes the same token unauthorized (401).
- Web update gate is returned to **disabled** before staging migration ends.

The invalid SHA cases still prove refusal and result feedback, while the
valid SHA matrix now independently proves successful end-to-end redeployment
from each HTTP authorization path. The
[2026-10-15 acceptance run](https://github.com/Ran-ying/linux-panel/actions/runs/38658227412)
passed in both `web` and `mcp` jobs, preserving the existing crash/recovery,
negative authorization and Broker migration tests. This does **not** prove
physical power loss, low-resource exhaustion, shared-production behavior,
or a user's actual ChatGPT connector session.

## Resource gate — conservative minimums, not a 3 GiB block

The root worker refuses in-place npm deployment **before stopping Web** only
when code filesystem space is below **1 GiB**, root backup filesystem space
below **256 MiB**, or combined `MemAvailable + SwapFree` below **768 MiB**.
Below 1.5 GiB combined memory/swap is a **warning**, not a rejection.
These are initial floor values, not a promise that all builds fit; record
real peak memory/disk usage from a disposable Ubuntu runner before enabling
the production Broker. A shared VPS with approximately 3.8 GiB free disk
is **not** rejected by the storage gate.

Approved jobs remain blocked until an exact root result is observed,
regardless of the proposal's 15-minute expiry, preventing a second
submission during a slow build.

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

## Fail-closed systemd startup gate (release gate)

A root-only update transaction can survive an interrupted or unsuccessful
rollback. Simply ordering the recovery service `Before=linux-panel.service`
is **not enough**: systemd may try to start the ordinary Web service even
if recovery exits with failure.

The fixed drop-in
`deployment/systemd/linux-panel-update-guard.conf` applies to the existing
`linux-panel.service` unit. It uses systemd PID1-evaluated *OR* conditions:
Web may start when the root transaction does not exist, **or** when the live
root Broker has provisioned an ephemeral permission marker inside its own
`/run/linux-panel-root-updater` RuntimeDirectory.

The root updater sets that marker only for its normal, controlled
`systemctl start linux-panel.service` operations while a transaction exists.
The marker is removed at process exit or SIGKILL/unit teardown. Boot recovery
instead queues a nonblocking restart and clears the durable journal before
systemd evaluates the queued Web start condition, avoiding the previous
Before= ordering deadlock.

The disposable Ubuntu acceptance tests a root journal with a **missing
state backup** while the installed Git HEAD differs from the desired old
SHA. Recovery must record `failed`, retain the journal, and a separate
`systemctl start linux-panel.service` must **not** result in an active
Web service. A test-only operator removes only its synthetic journal, then
checks Web starts normally. No production VPS recovery markers are removed.

Existing Broker installs receive this drop-in only through the distinct
operator-run `upgrade-update-broker.sh --apply` migration, including backup,
file ownership validation, post-install check and migration rollback.
Initial installs also install the guard. **Neither path activates updates.**

This strengthens recovery-failure safety but does not substitute for an
actual hard power-loss test. Real disk failure, journal durability and a
manual operator escalation process remain release-gate work.

## Crash and boot-recovery gate (phase II)

The fixed root Broker now writes a **root-only 0600 transaction journal**
`/var/lib/linux-panel-update-root/active-transaction` before stopping the
Web service. Every transaction carries its exact request ID, expected
`origin/main` SHA and old SHA. SIGKILL or a machine restart must not silently
erase the journal or the `update-processing` file.

`linux-panel-update-recover.service` is a **separate** real-systemd,
root-owned, hardened one-shot unit. Its fixed
`linux-panel-update-worker --recover-only` entrypoint cannot process new
`update-trigger` requests. When explicitly enabled during the later
production activation, systemd orders it before the Web service at boot.
Installation and Broker migrations leave this recovery unit **disabled**.

The recovery entrypoint takes the same privileged flock and validates the
journal identity and file permissions. If the trusted root result already
records success and Git HEAD equals the target, it cleans the journal; for an
unfinished transaction it attempts to restore the old SHA, rebuild the
previous assets, restore the exact private-state snapshot and start the
Web unit. It records `rolled_back` **only if these steps succeed**; on failure
it records `failed` and retains the journal for a reviewed operator retry.
Incomplete processing markers left before the journal was created are marked
failed and removed without performing a new Git update.

The disposable real-systemd acceptance additionally sends **SIGKILL**
during `npm ci`, checks the durable journal and stranded processing marker,
runs the isolated recovery service and verifies prior Git SHA/Web health,
then resumes the normal update/retry test. This is a **process crash and
boot-handler simulation**, not a literal VM power-cycle. Kernel crash,
filesystem durability under a hard power loss, filesystem-full rollback and
repeated failure under sustained memory exhaustion remain independent
release gates. Never use a production VPS for intentional SIGKILL injection.

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
