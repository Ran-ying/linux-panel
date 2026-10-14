# Linux Panel v0.5 · Platform updates for Web and MCP

The tool is intentionally **not** an arbitrary command executor.

## Roles

- `panel.update.request` 是标准写入（申请型）**Action**，Web 模块页面与 ChatGPT/MCP 均通过同一 `ActionEngine` 调用；`panel.update.status` 是只读 Action，也可在 Web 面板查看。
- MCP 调用还要求 `panel:update` OAuth Scope、全局策略显式授权；Web 调用需要管理员 Session 和 CSRF。两条入口由 ActionEngine 验证相同的 JSON Schema。
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
- Proposal MCP requires MCP enabled, `allowUpdates=true`, and `panel:update`. Direct MCP requires an activated Broker, `allowDirectUpdates=true`, and a **separately consented** `panel:update:execute` OAuth grant; neither route confers the other's permissions.
- `panel.update.check` is a read-only Web Action. It identifies SHA origin as `origin_main` (queried from configured Git remote) or `supplied_sha` (not remotely verified). Neither is a substitute for the broker's pinned-remote verification.
- `POST /api/panel/update/approve` requires Web Session, CSRF, password re-verification and optional fresh TOTP. `POST /api/panel/update/cancel` cancels only a still-unapproved proposal; MCP has no route to approve or cancel.
- The platform correlates the broker result ID with an approved proposal: a completed result stops showing as queued and releases the proposal slot. A still-running approval remains locked until its 15-minute expiry; overdue or failed jobs require independent operational inspection.
- Legacy `/api/extensions/mcp/update` and `.../approve` aliases remain temporarily for compatibility; new Web components use platform Actions and platform URLs.

## Explicitly delegated MCP direct updates (default OFF)

Web's one-confirmation update remains independent of MCP. Existing
`panel.update.request` and `panel:update` only create proposals requiring Web
approval. There is now a distinct high-impact MCP-only Action:

- `panel.update.execute` requires a new `panel:update:execute` OAuth grant.
- Web → MCP settings → **Allow MCP direct updates** must be explicitly enabled,
  independently from the `allowUpdates` proposal policy.
- The operator-owned Broker must first pass separate staging/rollback
  acceptance and be activated with `PANEL_UPDATER_ENABLED=1`. Merely installing
  its privileged worker does not enable either route.
- OAuth clients must **explicitly request** `panel:update:execute` and the
  administrator must confirm the interactive consent. Omitting OAuth scope
  gives **read-only** grants only; old `panel:update` grants are not upgraded.
- On every call the server verifies a live bearer, admin role, separate
  OAuth scope, current direct-update policy and activated Broker gate. The
  administrator can revoke the client grant or disable the policy immediately.
- Only an exact 40-character Git SHA or an empty argument to select configured
  `origin/main` is accepted. The fixed root Broker verifies pinned source,
  exact main HEAD, fast-forward lineage, resource thresholds, build, health
  and rollback. There is **no arbitrary shell or remote selector**.
- A `queued` result is not proof the deployment succeeded. Review the Broker
  result and systemd journal; requests are audited and concurrent work denied.

Direct MCP execution is a conscious delegation of deployment power to an
OAuth client. Some clients may ask for their own tool confirmation; the
server does not demand a *second* Web approval once the direct scope has
been explicitly granted. Never enable it on the shared production VPS
before the real root/systemd test matrix in
[UPDATE-ACCEPTANCE.md](UPDATE-ACCEPTANCE.md) is completed.

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

### Independent staging acceptance BEFORE activation

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
