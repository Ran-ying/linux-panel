# Linux Panel v0.5 · Platform updates for Web and MCP

The tool is intentionally **not** an arbitrary command executor.

## Roles

- `panel.update.request` 是标准写入（申请型）**Action**，Web 模块页面与 ChatGPT/MCP 均通过同一 `ActionEngine` 调用；`panel.update.status` 是只读 Action，也可在 Web 面板查看。
- MCP 客户端经 OAuth 登录一次后，可使用面板全局开放的 MCP Actions；不再按客户端 OAuth Scope 过滤工具。`panel.update.request` 仍需要全局 `allowUpdates`，`panel.update.execute` 仍需要全局 `allowDirectUpdates` 和已激活 Broker；Web 调用需要管理员 Session 和 CSRF。两条入口由 ActionEngine 验证相同的 JSON Schema。
- The MCP tool can propose **only one Git commit SHA**. No shell command,
  branch name, arbitrary URL, or user-provided script can be executed.
- The Web administrator must inspect the old/new SHA and confirm with their
  active browser session + CSRF + password re-verification. **TOTP is optional**: if the administrator enrolled it, a fresh TOTP code is mandatory; otherwise, the password suffices.
- A root-owned systemd path watcher invokes a fixed script when the approval
  marker is created. It validates the SHA equals the trusted origin/main HEAD
  and that it is a fast-forward update.
- The non-root `linuxpanel-updater` user executes Git/npm/test/build. At least 1 GiB must remain free on the checkout filesystem before the worker stops the app.
  The root broker only backs up private data, controls the specific systemd
  panel service, and restores prior state on failed deployments.

## Independent Web and MCP gates

- The operator-controlled `PANEL_UPDATER_ENABLED=1` switch is the platform-level *deployment* gate. Read-only `panel.update.check` and `panel.update.status` remain usable without it; their status reports `brokerEnabled: false`. It is **off by default** after broker installation too, and requires a separate staging acceptance plus explicit `--activate --ack-acceptance`.
- A logged-in administrator may check, request, cancel an unapproved request, or approve updates in the **Web 面板维护** page even if MCP is completely disabled.
- **Web one-click launch (after checking a candidate)**: the Web page presents the exact current/target SHA, asks for one explicit checkbox + administrator password (TOTP only if enabled), then performs the normal proposal and privileged approval back-to-back. There is no second Web approval click. This is a Web UX convenience, not an autonomous MCP permission; the Broker still validates the trusted remote, fast-forward, build, health and rollback. A successful queue response **is not proof** of deployment. If the second step fails, the pending proposal remains visible for review/retry.
- Trusted MCP clients share the **global** policy: enabling MCP exposes registered read Actions; `allowUpdates=true` adds proposal, while `allowDirectUpdates=true` **and an activated Broker** add direct execution. Existing authenticated clients gain or lose these tools immediately when the global policy changes. Client scopes remain OAuth compatibility metadata, **not per-client business-action permission gates**.
- `panel.update.check` is a read-only Web Action. It identifies SHA origin as `origin_main` (queried from configured Git remote) or `supplied_sha` (not remotely verified). Neither is a substitute for the broker's pinned-remote verification.
- `POST /api/panel/update/approve` requires Web Session, CSRF, password re-verification and optional fresh TOTP. `POST /api/panel/update/cancel` cancels only a still-unapproved proposal; MCP has no route to approve or cancel.
- The platform correlates the broker result ID with an approved proposal: a completed result stops showing as queued and releases the proposal slot. A still-running approval remains locked until its 15-minute expiry; overdue or failed jobs require independent operational inspection.
- Legacy `/api/extensions/mcp/update` and `.../approve` aliases remain temporarily for compatibility; new Web components use platform Actions and platform URLs.

## Personal trusted MCP client mode (global exposure)

The owner manages trusted AI clients on one personal panel. After an OAuth
authorization-code/PKCE login, **every authenticated non-revoked client** sees
all read-only registry Actions with explicit `exposure.mcp=true`, including new
ones added later. Legacy per-client OAuth scopes and persisted per-read-Action
checkboxes no longer restrict tool discovery or invocation. The OAuth consent
page describes the **full currently enabled tool set**, regardless of what
individual scopes the client happened to request. Existing grants also become
eligible for newly globally enabled Actions on `tools/list` refresh.
This is an intentional change from the former independently scoped model.

The Web MCP settings now have a compact set of **global** switches: endpoint,
new client registration, update proposals (`allowUpdates`), and direct
execution (`allowDirectUpdates`). They **do not** make /mcp anonymous:
valid bearer tokens, user account/credential checks and full-client revocation
are still required; unknown registry Actions and generic command execution
remain forbidden. Per-client scope editing was removed, but disconnecting
a client revokes its grant and tokens.

### Update actions remain constrained

- `panel.update.request`: exposed when `allowUpdates` and the Broker gate
  are enabled; requires separate Web review/approval, **regardless of
  historical OAuth scope**.
- `panel.update.execute`: exposed when `allowDirectUpdates` and the Broker
  gate are enabled; **no second Web approval per call** for an authenticated
  client, including clients previously authorized only for read Actions.
- Direct-action calls revalidate an active token, non-revoked grant, admin
  account/credential epoch, live global policy, exact Action registration,
  source pin and the fixed Broker gate before queue commit. All update
  targets are exact 40-char SHA or trusted `origin/main`; no arbitrary
  command, URL, or remote.
- Disabling direct execution removes that Action for *every* client
  immediately; client grant revocation terminates access completely. A
  `queued` receipt is **not** an update success; inspect the final Broker
  status, journal and Web health.
- **Security consequence:** enabling a new MCP Action for a connected AI
  client automatically makes it available to **all** connected AI clients,
  including existing sessions. Only enable direct updates when every current
  client is trusted for that capability. This mode is opt-in at the global
  policy level, not a mechanism for shared third-party tenant access.

## Tracked backend source permissions — October 2026 production 502 prevention

The immutable Broker was previously tested for Web access to npm dependencies
and built front-end assets only. Under the worker's `umask 077`, a Git checkout
or rollback can replace tracked `apps/api/src/create-app.js` or root
`package.json` as `0600` owned by `linuxpanel-updater`. The distinct Web UID
`linuxpanel` then fails on its first backend import and Nginx returns 502.
This happened during the attempted update after PR #82; independent recovery
eventually restored the previous revision. Do not attribute a source-file
`EACCES` to the newly introduced session-length logic.

[PR #83](https://github.com/Ran-ying/linux-panel/pull/83) changes the immutable
worker's `ensure_web_read_access` so **both forward deployments and recovery**
regrant Web group read/traverse on actual Git-tracked source files and their
checked directories, in addition to npm dependencies and built assets. The
Web user is never granted write; `.git`, untracked files, private state and
root-owned rollback artifacts are excluded. Actual service-UID read probes
precede Web startup, and disposable Ubuntu systemd update/rollback tests inject
`0600` source before asserting HTTP health.

**New-user gates:** the application `scripts/install.sh` requires the Web UID
to read and import `apps/api/src/create-app.js` and read root
`package.json`, in addition to the entrypoint, dependencies and front-end;
all Git-tracked backend files checked here must remain non-writable by Web.
Optional Broker installation `scripts/install-update-broker.sh` checks these
same files in preflight, after `--apply` and on `--verify`. A disposable
Ubuntu fresh-install CI workflow verifies the installed runtime; independent
real-systemd CI actively sets `package.json` and `create-app.js` to `0600`
and requires `--verify` to reject them. These checks prevent a silent
unreadable-source acceptance; they do not replace independent future hardware
or distro verification.

**Already-installed Broker migration:** source code updates do NOT replace the
root-owned `/usr/local/libexec/linux-panel-update-worker`. On any host that
still has the older worker, **do not trigger another MCP or Web auto-update**,
even if new GitHub `main` has the fix. Follow
[controlled privileged Broker migration](#upgrade-an-already-installed-immutable-broker-without-activation)
with an explicit operator-approved maintenance window, provider snapshot,
trusted source pin, clean checkout, Web update gate OFF, watcher and recovery
unit disabled, zero transaction markers, and `upgrade-update-broker.sh --check`
reporting zero BLOCK before `--apply`. After migration verify root worker
byte identity and live Web health, then separately reactivate using the normal
operator signoff. No ordinary MCP Action, `git pull` alone or root-owned
worker self-update is a substitute for this migration.

## Git refs group access without breaking systemd sandbox (2026-10-15)

The fixed Broker runs Git as `linuxpanel-updater` with `umask 077` under
`RestrictSUIDSGID=true`. Its distinct Web user, `linuxpanel`, must be
able to read local Git `HEAD` for Web/MCP update preflight. Earlier
`core.sharedRepository=0640` allowed group-read for refs but made Git
attempt SGID directory creation for new fetched objects. The fixed root
worker's systemd seccomp rejects this with `Operation not permitted`.
**Do not weaken the systemd sandbox or keep numeric core.sharedRepository.**

The corrected *fresh installer* uses local `core.sharedRepository=umask`
and Linux POSIX default ACLs, via the Python stdlib helper
[`scripts/configure-git-web-acl.py`](../scripts/configure-git-web-acl.py).
Default ACLs apply to Git metadata directory descendants created under a
restrictive umask without making Git explicitly request SGID bits.
Named `linuxpanel` group entries grant only read/traverse, not write.
New installs apply this before activating the Broker.

### Already-installed Broker: one-time scoped operator repair

When an MCP execution returns `queued` then a durable `failed` result,
and `journalctl -u linux-panel-update.service` shows
`error: unable to create temporary file: Operation not permitted` at
`git fetch`, confirm `core.sharedRepository` is `0640`; use the
following preflight and repair. It does **not** restart the service,
reinstall the Broker, fetch source or change public/private server data.

```bash
ROOT=/opt/linux-panel
sudo systemctl is-active --quiet linux-panel.service
! systemctl is-active --quiet linux-panel-update.service
sudo test ! -e /var/lib/linux-panel-update-root/active-transaction
sudo test ! -e /var/lib/linux-panel/update-trigger
sudo test ! -e /var/lib/linux-panel/update-processing
test -z "$(sudo runuser -u linuxpanel-updater -- git -C "$ROOT" status --porcelain)"
sudo runuser -u linuxpanel-updater -- git -C "$ROOT" config --local core.sharedRepository umask

# Ubuntu/Debian may require: sudo apt install acl
command -v setfacl
command -v getfacl
for d in .git .git/refs .git/refs/heads .git/refs/remotes \
         .git/refs/remotes/origin .git/objects; do
  if sudo test -d "$ROOT/$d"; then
    sudo test ! -L "$ROOT/$d" || exit 1
    sudo setfacl -m 'g:linuxpanel:rx,m::rx,o::---,d:g:linuxpanel:rx,d:m::rx,d:o::---' "$ROOT/$d"
  fi
done
for f in .git/HEAD .git/config .git/refs/heads/main \
         .git/refs/remotes/origin/main .git/packed-refs; do
  if sudo test -f "$ROOT/$f"; then
    sudo test ! -L "$ROOT/$f" || exit 1
    sudo setfacl -m 'g:linuxpanel:r--,m::r--,o::---' "$ROOT/$f"
  fi
done
sudo runuser -u linuxpanel -- git -c safe.directory=/opt/linux-panel -C "$ROOT" rev-parse HEAD
sudo getfacl -p "$ROOT/.git/refs/heads" "$ROOT/.git/objects"
```

**Preflight commands must each succeed before proceeding.** Git must be
clean, no pending root journal/markers, and the Web service must be healthy.
If `setfacl` or filesystem ACL support is unavailable, stop and get an
operator-reviewed alternative instead of disabling `RestrictSUIDSGID`.
Keep `core.sharedRepository=umask`; do **not** change it back to
`0640` or `group`.

After checking the exact reviewed `main` and green CI, enqueue one update
through MCP and check the persisted result, clean exit of the worker and
Web/MCP health. Never equate a `queued` response with deployment success,
and do not reinstall/migrate the immutable privileged worker for this
ACL-only issue.

## Independent operator-owned Broker installation: check → apply → verify → activate

Linux Panel is **independent of Nginx, domains and TLS**. Its ordinary
`scripts/install.sh` installs the non-root Web service only. Privileged updates
are optional, installed once by an OS-level administrator from a **separate**
script. Neither MCP nor the Web service can grant itself root privileges.

### Preflight (read-only; mandatory)

On **Ubuntu 24.04+ or Debian 12+, systemd >= 240**, first ensure the
application is already healthy and its tracked `/opt/linux-panel` checkout is
clean on `main`. Back up the VPS or take a VM snapshot before any privileged
bootstrap, especially on servers with other services.

```bash
cd /opt/linux-panel
sudo bash scripts/install-update-broker.sh --help
sudo bash scripts/install-update-broker.sh --check
```

`--check` does **not** create users, alter permissions, install systemd units,
enable Web/MCP controls, pull Git changes or restart services. It checks:

- OS/systemd sandbox compatibility and required host commands;
- clean, readable `main` checkout and credential-free expected GitHub origin;
- existing running `linux-panel.service`, admin state, service user and group;
- dedicated Node 24 toolchain, free memory/swap and disk space;
- no preexisting worker, pin, systemd units, account, trigger or result directory.

`[PASS]` means satisfied; `[WARN]` requires an operator decision (for example
less than the recommended 5 GiB free space); `[BLOCK]` must be fixed before
installation. **Do not bypass an OS/systemd BLOCK**. When any Broker artifact
already exists, do **not** delete it to force a new first install; inspect with
`--verify` and recover with a separate reviewed plan instead.

### Install (explicit; does not enable updates)

Only after all BLOCKs are resolved and the expected changes have been reviewed:

```bash
cd /opt/linux-panel
sudo bash scripts/install-update-broker.sh --apply
sudo bash scripts/install-update-broker.sh --verify
```

`--apply` creates `linuxpanel-updater`, takes root-only backups of
`panel-state.json`, `panel.env` and the main systemd unit, installs the fixed
root-owned worker and trusted Git remote pin, changes checkout ownership to the
low-privilege updater account (while leaving the Web account **read-only**),
installs the systemd unit files, and reloads the systemd manager.

**New behavior:** it deliberately does **not** enable or start the
`linux-panel-update.path` watcher, does **not** set
`PANEL_UPDATER_ENABLED=1`, does **not** restart the running panel and does
**not** perform any Git update. The Web UI should still say Broker not enabled;
that is **expected and correct** while safety acceptance is outstanding.

`--verify` is read-only; it checks pinned repository identity, root worker,
checkout permissions, unit ownership and **effective** `ProtectSystem=strict`,
`NoNewPrivileges=yes` and `ReadWritePaths`. Examine its WARNs; also run
`systemd-analyze security linux-panel-update.service` where supported, and
review actual unit properties. A successful `--verify` is *necessary but not
sufficient* to declare the Broker production-ready.

### Upgrade an already-installed immutable Broker (without activation)

If `install-update-broker.sh --apply` was run in the past, **do not repeat**
first installation, delete old root files or just run `git pull` and assume
the fixed privileged worker changed. The installer copied **two immutable
root-owned artifacts** outside the Git tree. Source updates do not replace:

- `/usr/local/libexec/linux-panel-update-worker`
- `/etc/systemd/system/linux-panel-update.service`

A separate **operator-only migration script** upgrades exactly those two
artifacts. It requires a healthy running panel, clean cached `origin/main`
checkout owned by `linuxpanel-updater`, unchanged root-owned Git pin, watcher
both disabled and inactive, Web gate OFF, zero pending/processing markers,
and safe existing worker/unit/backup ownership and file types.

Take a separate VPS snapshot first. Review the Git diff/commit on the
server before any new root-owned script is executed. **Do not run this flow
if the Broker is enabled, processing updates or partially installed.**

```bash
# 1. Update checked-out source only — not the installed root worker.
sudo runuser -u linuxpanel-updater -- \
  git -C /opt/linux-panel pull --ff-only origin main
cd /opt/linux-panel

# 2. Read-only verification; examine WARN and SHA256 differences.
sudo bash scripts/upgrade-update-broker.sh --check

# 3. Explicit privileged migration. NO Web gate, watcher or app restart.
sudo bash scripts/upgrade-update-broker.sh --apply

# 4. Confirm exact installed/source match and disabled policy.
sudo bash scripts/upgrade-update-broker.sh --verify
sudo bash scripts/install-update-broker.sh --verify
```

`--check` and `--verify` are read-only; `--apply` uses a root-only flock,
a separate root-only timestamped backup for each attempt, staged replacements
and atomic per-file rename. On a post-swap error it tries to restore the old
worker and unit and reload systemd. Re-running an already-current `--apply`
is a no-op. It does not change the Git pin, private state, account ownership,
Nginx, DNS, TLS, third-party services or public Web/MCP permissions.
The operator must inspect warnings or failed recovery before retrying.

A disposable [real Ubuntu 24.04 systemd migration test](../.github/workflows/broker-acceptance.yml)
starts with an old pinned installation, injects a daemon-reload failure,
verifies restoration, then migrates to current artifacts without touching
the panel process. That test is **not** permission to enable deployment:
in-flight power loss, resource exhaustion and full OAuth/Web end-to-end
acceptance are separate gates in [UPDATE-ACCEPTANCE.md](UPDATE-ACCEPTANCE.md).

### Fail-closed Web service guard during unresolved recovery

The installer and existing-Broker migration now manage a root-owned systemd
drop-in `/etc/systemd/system/linux-panel.service.d/90-update-recovery-guard.conf`.
When a root transaction remains unresolved, systemd skips an ordinary Web
start. A live, root-owned Broker has a transient permission inside its
volatile RuntimeDirectory to restart Web for health checking and rollback.
It disappears after the Broker exits and does not authorize unrelated
shell commands or grant MCP permissions.

Operators must not delete the root-only
`/var/lib/linux-panel-update-root/active-transaction` to "fix" a failed
boot without inspecting the Git checkout, private state backup and Broker
result. Inspect `systemctl status linux-panel-update-recover.service` and
`journalctl -u linux-panel-update-recover.service`, take a VPS snapshot and
follow the tested recovery runbook. The drop-in does not get installed by
a Git pull alone; use the separate checked migration.

### Interrupted update recovery (disabled until release acceptance)

The root Broker journals the approved request and old SHA in a root-only
`/var/lib/linux-panel-update-root/active-transaction` **before** stopping
the panel. Unfinished journal/processing files block new deployments.

A separate fixed, sandboxed systemd one-shot unit,
`linux-panel-update-recover.service`, runs only the
`linux-panel-update-worker --recover-only` entrypoint at boot, with **no**
`Before=linux-panel.service` dependency (that would deadlock a synchronous
Web HTTP-health probe). Instead the root journal's systemd startup guard
fails closed until the recovery worker explicitly grants a temporary
startup permit. It does not fetch a new target or consume update-trigger
markers. It validates the journal and either recognizes an already recorded
successful deployment, or restores the saved revision and private state,
rebuilds, restarts the panel and records `rolled_back`. If restoration fails,
the journal is retained and a `failed` result is published; the operator must
investigate rather than silently retrying new updates.

First installation and the existing-Broker migration install this recovery
unit but leave it **disabled**. Only the separately attested production
`--activate --ack-acceptance` enables both the update watcher and boot
recovery service. Before that point, use the read-only installer/migration
checks; do not manually start the worker or remove recovery markers on a
shared production VPS.

The ephemeral Ubuntu real-systemd workflow tests process SIGKILL during
`npm ci` followed by manual invocation of the boot recovery service.
It does **not** constitute a real power-off, low-memory or full-disk test.

#The [production deployment gate](PRODUCTION-DEPLOYMENT-GATE.md) separates
read-only resource/identity checks, existing-Broker migration and the
explicit operator-only activation decision. This guide never authorizes
automatic production enablement.

## Independent staging acceptance BEFORE activation

Follow [UPDATE-ACCEPTANCE.md](UPDATE-ACCEPTANCE.md) on a **disposable** Ubuntu
24.04/Debian 12+ VM (snapshot, test Git remote, no live credentials) to test
positive updates, scope/revocation checks, incorrect commits, concurrent
requests, test/build/startup failures, rollback failure and interruptions.
Record results and conduct a separate security review of sandbox properties.
Green GitHub CI or a real production preflight does **not** replace that
evidence. Keep the production Broker disabled until the requirements pass.

### Activate (separate and explicit operator decision)

After the acceptance checklist has been completed and signed off, an
administrator may opt into actual updates:

```bash
cd /opt/linux-panel
sudo bash scripts/install-update-broker.sh --verify
sudo bash scripts/install-update-broker.sh --activate --ack-acceptance
sudo systemctl status linux-panel-update.path --no-pager
sudo systemctl is-active linux-panel.service
```

The `--ack-acceptance` flag is a **human attestation**, not an automated test.
Activation revalidates installation state, backs up `panel.env` again, enables
the watcher and Web update flag, and restarts **only** `linux-panel.service`.
If the service fails to restart, the activation command attempts to disable the
watcher and restore the previous configuration. It does not request an update
by itself. MCP updates still require a separately authorized policy and
`panel:update` scope.

**Private repository:** configure a dedicated read-only Git Deploy Key for
`linuxpanel-updater` if needed; never let `linuxpanel` own the key. Verify
using `sudo runuser -u linuxpanel-updater -- git -C /opt/linux-panel ls-remote origin refs/heads/main`.
Do not paste credentials or private hostnames into an open-source repo.

**CentOS 7** / systemd 219 is blocked by design; do not bypass the check.
Its Web and read-only MCP functions may continue without this Broker.

## Once installed: end-to-end update workflow

1. Log into Web → Security. TOTP enrollment is **optional**. If enabled, save the recovery codes offline; enrollment invalidates existing OAuth tokens and requires reconnecting the AI client. No authentication app is needed when TOTP is off.
2. **Web-only updates:** keep MCP completely disabled and proceed to step 4.
   **Optional MCP proposals:** enable MCP in Web settings, temporarily allow
   registration, explicitly tick Allow update requests, and scope each client.
3. Only for MCP: authorize the AI client for `panel:update`. Existing
   access tokens do not gain that scope retroactively.
4. **Web**：在「面板维护」检查版本后，可核对完整 SHA、输入密码（及已启用时的 TOTP）并直接点击「确认并立即更新」。该按钮复用既有申请与审批 API，一次操作完成这两个阶段，随后跳至步骤 6；也可以按传统流程只创建申请。
   **MCP**：Ask the AI: “Check GitHub main and request a Linux Panel update.”
   It reads the full SHA, proposes it via `panel.update.request`, then
   returns an approval-required response. **It has not updated anything.**
5. **仅对 MCP 申请或 Web 传统两阶段操作**：Web → 面板维护 → update request: verify old → proposed Git SHA,
   password, and a fresh TOTP code **only if you enabled TOTP**; click approve.
6. The path watcher executes tests, syntax, frontend build and restart.
   The AI connection may temporarily disconnect. Reconnect and inspect
   the update status and system service after the worker completes.
7. If tests, build, startup or local HTTP health check fail, the worker
   tries to restore the old Git SHA/dependencies/private state and reports
   `rolled_back` or `failed`. Review `journalctl -u linux-panel-update.service`
   before retrying.

See [UPDATE-ACCEPTANCE.md](UPDATE-ACCEPTANCE.md) for a fail-closed staging test matrix before treating the broker as production-ready.

## Commands for operations

```bash
systemctl status linux-panel-update.path --no-pager
systemctl status linux-panel-update.service --no-pager
journalctl -u linux-panel-update.service -n 100 --no-pager
systemctl status linux-panel.service --no-pager
```

Avoid manually replacing the root-owned worker from a remote Git file.
The broker is **not self-updating**. Updating its script or systemd policy
requires a deliberate administrator review and installation.

## Explicit non-goals

- No unattended update based only on an AI-generated confirmation sentence.
- No general-purpose root shell, host file write API or arbitrary git remote.
- No privileged build/npm script execution.
- No automatic downgrade/rebase; only verified fast-forward main.
- No high-availability or multi-instance deployments.

The GitHub source may be public before the installer receives real
VPS end-to-end acceptance; treat those as independent milestones.
