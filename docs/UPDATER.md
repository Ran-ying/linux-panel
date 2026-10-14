# Linux Panel v0.5 · AI-initiated Git updates via MCP

The tool is intentionally **not** an arbitrary command executor.

## Roles

- `panel.update.request` 是标准写入（申请型）**Action**，Web 模块页面与 ChatGPT/MCP 均通过同一 `ActionEngine` 调用；`panel.update.status` 是只读 Action，也可在 Web 面板查看。
- MCP 调用还要求 `panel:update` OAuth Scope、全局策略显式授权；Web 调用需要管理员 Session 和 CSRF。两条入口由 ActionEngine 验证相同的 JSON Schema。\n- The MCP tool can propose **only one Git commit SHA**. No shell command,
  branch name, arbitrary URL, or user-provided script can be executed.
- The Web administrator must inspect the old/new SHA and confirm with their
  active browser session + CSRF + password re-verification. **TOTP is optional**: if the administrator enrolled it, a fresh TOTP code is mandatory; otherwise, the password suffices.
- A root-owned systemd path watcher invokes a fixed script when the approval
  marker is created. It validates the SHA equals the trusted origin/main HEAD
  and that it is a fast-forward update.
- The non-root `linuxpanel-updater` user executes Git/npm/test/build. At least 1 GiB must remain free on the checkout filesystem before the worker stops the app.
  The root broker only backs up private data, controls the specific systemd
  panel service, and restores prior state on failed deployments.

## Initial operator-only installation

The current MCP connection offers read-only system tools. It cannot safely
install its own privileged updater. This is **one manual bootstrap**; later
updates no longer require manual `git pull`.

Before enabling anything:

1. Ensure your Git checkout is clean and under `/opt/linux-panel`.
2. Back up `/var/lib/linux-panel/panel-state.json` and systemd/Nginx config.
3. Review `scripts/install-update-broker.sh`,
   `scripts/update-worker.sh`, and both
   `deployment/systemd/linux-panel-update.*` files.
4. Verify systemd **>= 240** (older releases may silently ignore sandbox policy), `PathExists`, `flock`, `runuser`, `curl`,
   Git and Node/npm. The updater assumes systemd and an existing
   `linux-panel.service` but does not manage an Nginx site.
5. Run **once**, on the VPS:

```bash
cd /opt/linux-panel
sudo bash scripts/install-update-broker.sh
```

The installer copies the audited worker into
`/usr/local/libexec/linux-panel-update-worker` (root owned),
installs a root-owned `/etc/linux-panel/update-source` pin and systemd
`linux-panel-update.path/.service`, creates an independent
`linuxpanel-updater` user and assigns checkout write access **only** to that account (the Web service still runs as `linuxpanel`, with read-only group access to the checkout).
It opts the Web application into showing the update feature via
`PANEL_UPDATER_ENABLED=1`; MCP update permission and OAuth Scope
remain **OFF** until you explicitly enable them.

**Private repository**: `linuxpanel-updater` needs its own read-only
Deploy Key for the Git remote. The existing `core.sshCommand` may point
to an inaccessible root-owned key: fix it to a key owned by
`linuxpanel-updater`, and verify:

```bash
sudo runuser -u linuxpanel-updater -- \
  git -C /opt/linux-panel ls-remote origin refs/heads/main
```

The Web user `linuxpanel` should *not* have the updater's private key.
For a private GitHub repo, ChatGPT can use its GitHub connector to read
the current full `main` SHA and submit that as the optional
`targetSha` to MCP. The broker verifies it independently using the
updater account's credentials. If the repo is public, omitting
`targetSha` lets the application query origin/main directly.

**CentOS 7**: The bootstrap installer explicitly **rejects** its old systemd. Do **not** bypass this check: important root-worker sandbox directives are not supported. Migrate to a supported Linux OS (e.g. Ubuntu 24.04 LTS or Debian 12+) or design and independently audit a dedicated legacy broker first. The current Linux Panel may keep operating with read-only MCP meanwhile.

## Once installed: end-to-end update workflow

1. Log into Web → Security. TOTP enrollment is **optional**. If enabled, save the recovery codes offline; enrollment invalidates existing OAuth tokens and requires reconnecting the AI client. No authentication app is needed when TOTP is off.
2. Web → MCP settings: enable MCP, temporarily allow registration, and
   explicitly tick **Allow update requests**. Keep individual read tools
   scoped to your needs.
3. Authorize the AI client for the new `panel:update` scope. Existing
   access tokens do not gain that scope retroactively.
4. 在 Web 的「面板维护」模块调用 `panel.update.request`，或 Ask the AI: “Check GitHub main and request a Linux Panel update.”
   It reads the full SHA, proposes it via `panel.update.request`, then
   returns an approval-required response. **It has not updated anything.**
5. Web → MCP settings → update request: verify old → proposed Git SHA,
   password, and a fresh TOTP code **only if you enabled TOTP**; click approve.
6. The path watcher executes tests, syntax, frontend build and restart.
   The AI connection may temporarily disconnect. Reconnect and inspect
   the update status and system service after the worker completes.
7. If tests, build, startup or local HTTP health check fail, the worker
   tries to restore the old Git SHA/dependencies/private state and reports
   `rolled_back` or `failed`. Review `journalctl -u linux-panel-update.service`
   before retrying.

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
