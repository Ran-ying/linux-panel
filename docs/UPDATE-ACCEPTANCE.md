# v0.5 Updater — Acceptance and Release Gate

**Status: PARTIAL REAL-SYSTEMD ACCEPTANCE PASSED; NOT PRODUCTION RELEASE-READY.** On a disposable GitHub-hosted Ubuntu 24.04 runner, the actual privileged service, restricted account, Git and npm completed invalid SHA rejection, an injected test failure with rollback, and successful retry. SIGKILL recovery and both Web/MCP valid-SHA deployment paths have now passed in isolated runners. Literal hard-power-loss integrity, physical power-loss and resource-starvation scenarios remain unverified; basic
parallel Web/MCP enqueue rejection is verified but revocation during execution
and more exhaustive multi-client races remain open.

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
- Two simultaneous Web password-step-up approvals for one request yield exactly
  one queued update and one HTTP 409; one result arrives from the actual
  systemd Broker. Two distinct OAuth clients with independently consented
  `panel:update:execute` grants race for the same candidate SHA; exactly one
  is queued, while the second tool call is rejected. No duplicate root job
  or false successful deployment is accepted.
- Web update gate is returned to **disabled** before staging migration ends.

The invalid SHA cases still prove refusal and result feedback, while the
valid SHA matrix now independently proves successful end-to-end redeployment
from each HTTP authorization path. The
[2026-10-15 acceptance run](https://github.com/Ran-ying/linux-panel/actions/runs/38658227412)
passed in both `web` and `mcp` jobs, preserving the existing crash/recovery,
negative authorization and Broker migration tests. This does **not** prove
physical power loss, low-resource exhaustion, shared-production behavior,
or a user's actual ChatGPT connector session.

## QEMU guest hard-power smoke (separate, deliberately partial gate)

The disposable `qemu-powercut.yml` workflow boots a real Ubuntu 24.04
QEMU guest from a checksum-verified official cloud image, creates fresh
one-run-only SSH credentials and a writable guest disk, and **kills the QEMU
process without asking the guest kernel/systemd to shut down**. It reboots
the exact same guest disk twice. The tested boundaries are:

1. After the real, checked-out non-root `StateStore.mutate()` commits a
   private JSON update and after the immutable Broker's checked-out
   `durable_sync()` function flushes an illustrative root-only journal
   and processing marker. After abrupt VM termination/reboot, the test
   requires the correct private JSON, journal, processing metadata and
   root-only journal permissions.
2. After the same fixed `durable_sync()` helper commits an illustrative
   final success-result file and flushes deletion of the processing and
   journal markers. The guest is hard-killed again and rebooted; the final
   JSON result must still exist and neither deleted marker may reappear.

These are **actual guest-wide virtual power cuts**, unlike process SIGKILL.
The workflow runs only on disposable GitHub-hosted runners and never uses
production private state. It covers persistence at two file-operation
boundaries, **not** the complete systemd root Broker, Git/npm build, active
rollback, or automated boot recovery. The broader hard-shutdown release gate
remains OPEN until those transitions are exercised under an actual VM
shutdown with before/after integrity and operator evidence. Do not mark
production-safe based on the smoke run alone.

## Private-state persistence boundary

The non-root Node.js `StateStore.mutate()` already fsyncs a new 0600 JSON
temporary file, then atomically renames it into place. Linux now explicitly
fsyncs the containing directory **after** rename, before reporting mutation
success. This covers Web login, OAuth grants, approval/audit changes and other
panel state mutations that occur *before* the root updater makes a separate
durable snapshot. A directory-sync failure propagates to the caller rather
than being reported as a committed success.

The new state-store durability unit tests reopen the committed state and
verify permissions, serial mutations, and the absence of leftover temp files.
These tests do not simulate a guest hard shutdown, a write-cache lie, or
filesystem corruption. The full VM power-cut release gate remains open.

## Transaction disk barriers (partial power-loss hardening)

The immutable root Broker now writes the journal and status result through
same-filesystem temporary files, followed by file `fsync`, atomic rename and
parent-directory `fsync`. The result file no longer moves across potentially
different backup/result filesystems, which would break atomic-replace semantics.

The private-state snapshot is constructed and synced under a temporary backup
name before publication; an interrupted copy is **not** accepted as a finished
backup. The restore path similarly fsyncs a complete state file before swapping
it into place. An update records a durable final result, then deletes/syncs
the processing marker **before** removing/syncing the root transaction journal:
a reboot cannot reasonably reinterpret an already-committed success as an
abandoned in-flight marker. All critical barriers fail closed on I/O errors.

The fixed root worker uses isolated `/usr/bin/python3 -I` only for operating
system `fsync` calls on fixed paths; the explicit installer/migration preflight
requires that trusted binary. It does not execute Python from the writable Git
checkout and does not accept a path from the OAuth/MCP client.

**Limitations:** File and directory fsync improve ordering on supported Linux
filesystems but are not a measured hard-power-off result. They do not make the
whole npm/Git/build tree transactional, and cannot correct storage firmware
that lies about durable writes. Snapshot-based abrupt VM shutdown, mount-level
failure injection and resource exhaustion remain explicit Issue #35 gates.
Never claim production hard-power-loss acceptance solely from these barriers.

## Partial I/O and ENOSPC semantics

The immutable Broker's fixed-format root journal and result file writes now
check the **initial printf**, chmod, chown and file fsync separately before an
atomic rename. A short/failed write cannot be made durable merely because a
later chmod or fsync succeeds. If a marker, result, or processing directory
cannot be synchronized, the root journal is retained rather than claiming
completed cleanup.

Rootless fault-injection tests intercept the Bash printf builtin in an
**isolated copy** of the worker: they write a partial journal/result before
returning ENOSPC (exit 28). The journal scenario must not stop Web or
publish a truncated root transaction; the result scenario must not expose
malformed JSON as a completed result. These checks are stronger than
preflight df tests, but are **not** a real full-disk systemd run, which
remains a separate acceptance requirement.

## Deliberate cgroup OOM recovery (disposable staging)

The real Ubuntu 24.04 systemd acceptance temporarily applies
`MemoryMax=96M` **only to the root Broker test unit**. A staging-only
npm-ci subprocess attempts to allocate 512 MiB after the privileged
worker has created its durable transaction journal. Acceptance requires
no update `success`, a final `rolled_back` result, the original Git HEAD,
healthy Web, and no stale root journal or processing marker. The runner
removes the cgroup limit before independently invoking recovery.

This deliberately forces a **real cgroup OOM**, not a mocked memory counter.
It never runs on production VPSs and does not prove the actual 962 MiB
server's concurrent resource use, swap headroom or ENOSPC rollback.
Those release gates remain separate and open.

## Real npm transaction with a 768 MiB cgroup cap

On the disposable Ubuntu 24.04 Web/MCP positive-update matrix, the entire
fixed root Broker's **actual** `npm ci`, MCP dependencies, `npm run check`,
`npm test`, `npm run build:web`, Git and Web restart are now run with
`MemoryMax=768M` and `CPUQuota=100%` (single-vCPU equivalent) on the
worker's systemd cgroup. The harness requires the
real Git SHA transition, healthy HTTP, durable `success`, and reports the
worker's live cgroup-v2 `memory.peak`, total positive-update wall time,
and code-volume free space before/after the build.
The memory and CPU caps are removed immediately after the positive
transaction. The rest of the disposable runner still has more resources
than the production VPS; this specifically constrains the updater cgroup.

**Measured evidence (disposable Ubuntu 24.04, 2026-10-15):**
[GitHub Actions 38697686455](https://github.com/Ran-ying/linux-panel/actions/runs/38697686455)
completed `success` for both Web and MCP jobs. Kernel cgroup-v2
`memory.peak` recorded **342,978,560 bytes** (Web) and
**342,577,152 bytes** (MCP), about 327 MiB for each complete isolated
updater transaction. Both full builds and HTTP restart succeeded under
`MemoryMax=768M`. These are observed one-run figures, not a worst-case
memory bound or production coexistence guarantee.

**Important:** This is an actual cgroup restriction on a host with more
memory than the user's roughly 962 MiB VPS; it is not proof of simultaneous
coexistence with other services on that VPS, nor a check of production swap.
If the full build exceeds 768 MiB, the runner must fail rather than hiding
an OOM. Production requires a separate swap and free-resource preflight.

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
The marker is removed at process exit or SIGKILL/unit teardown. The boot recovery service no longer orders itself `Before=` the Web
unit: that dependency previously forced asynchronous start and could
report `rolled_back` **before** Web HTTP health was known. Both ordinary
rollback and boot recovery now start Web synchronously using the live root
permit, wait for the configured HTTP listener, and clear the journal only
after readiness is verified. If the service is active but unreachable,
recovery stops it, reports `failed` and retains the transaction for
explicit operator review/retry. Normal boot may initially skip Web while
the journal exists; the successful root recovery starts it itself.

The disposable Ubuntu acceptance also injects a temporary service
that is `active` but never serves HTTP, checks a `failed` result, retained
root journal and unchanged private-state digest, then removes the injected
unit and retries successfully. It also tests a root journal with a **missing
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
