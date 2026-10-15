# Production VPS deployment gate (Linux Panel v0.5)

> **Operator-only runbook. Not a release authorization.** Issue #35 must have
> documented acceptance and explicit human approval before the privileged
> updater watcher or Web update gate is activated. This page has no authority
> to override `--check`/`--verify` blocks. Do not run fault injection here.

## Evidence required for a release decision

- Exact candidate Git **main** SHA; ordinary CI on that SHA is green.
- Both **real disposable Ubuntu 24.04 systemd** Web/MCP positive updates pass
  with true npm ci/check/test/build, invalid SHA denial, worker SIGKILL,
  independent boot recovery, injected npm failure, true cgroup OOM, isolated
  result-volume ENOSPC and migration rollback/retry.
- QEMU **host-terminated guest** tests pass: file/directory fsync barriers
  and interruption of the *actual immutable root Broker* mid-transaction,
  with the same guest disk rebooted, matching old Git SHA, byte-identical
  private state, healthy HTTP and exact `rolled_back`. Clearly distinguish
  npm/Web fixtures from full dependency-build evidence.
- OAuth/direct MCP grants and policy are checked at the serialized queue
  commit after asynchronous Git I/O, with revoked permissions rejected.
- Root-owned worker/unit/source-pin integrity and effective sandboxing are
  independently inspected. No open P0/P1 issue without an explicit documented
  acceptance of its bounded impact and a tested operator recovery path.

## Read-only production inspection (no activation)

The commands below must be run by the owner through their own trusted SSH
session. They **do not** change the server. Avoid publishing the host name,
user state, credentials, OAuth tokens, or the results of any private config
file in issue/PR comments.

```bash
cd /opt/linux-panel
git status --short --branch
git rev-parse HEAD
systemctl is-active linux-panel.service
systemctl is-enabled linux-panel-update.path || true
systemctl is-active linux-panel-update.path || true
systemctl is-enabled linux-panel-update-recover.service || true
systemctl is-active linux-panel-update.service || true
awk '/^MemAvailable:|^SwapFree:/ { print }' /proc/meminfo
df -h /opt/linux-panel /var/lib/linux-panel-update-root
sudo bash scripts/upgrade-update-broker.sh --check
```

For an installed older Broker, a `--check` warning that current checked-out
source differs from its immutable root worker is expected **only before**
the separately authorized migration. A `[BLOCK]` or inconsistent root
journal is a stop condition, not something to bypass by deleting files.

The worker's current preflight floors are **1 GiB** free on the code
filesystem, **256 MiB** free on the root-backup filesystem, and
**768 MiB combined MemAvailable + SwapFree**. They are lower bounds, not
a guarantee of deployment memory. Record how much is left for other active
services; take a separate VPS/provider snapshot, verify its restoration
mechanism, and maintain a separate SSH/recovery channel.

## Source refresh and immutable Broker migration (requires approval)

Only after the owner has reviewed the exact SHA, a restorable VPS snapshot
and the read-only preflight. An **existing installed** Broker is updated
using this migration path; **never rerun first installation** or delete
root worker files to coerce the installer.

```bash
sudo runuser -u linuxpanel-updater -- \
  git -C /opt/linux-panel pull --ff-only origin main
cd /opt/linux-panel
sudo bash scripts/upgrade-update-broker.sh --check
sudo bash scripts/upgrade-update-broker.sh --apply
sudo bash scripts/upgrade-update-broker.sh --verify
sudo bash scripts/install-update-broker.sh --verify
systemctl is-active linux-panel.service
```

This migration intentionally does **not** enable the watcher, switch on
`PANEL_UPDATER_ENABLED`, execute a remote update, or restart Web. The
reviewer must confirm the original panel API, TLS reverse proxy and other
unrelated services are still healthy. If checks fail, preserve root-only
transaction evidence and use the migration's backed-up artifacts rather
than running arbitrary repair commands.

## Activate only after an explicit operator release decision

Once all acceptance evidence is green and the owner approves the
production activation itself, separately run:

```bash
cd /opt/linux-panel
sudo bash scripts/install-update-broker.sh --verify
sudo bash scripts/install-update-broker.sh --activate --ack-acceptance
sudo systemctl status linux-panel-update.path --no-pager
sudo systemctl is-active linux-panel.service
```

The acknowledgement is a **human sign-off**, not proof that every failure
mode is covered. Activation enables the OS watcher and the separate boot
recovery unit, writes the Web gate, and restarts the panel. It does **not**
trigger a Git update. Keep MCP direct-update policy/grants OFF initially;
test the Web-only authenticated **read-only** status and HTTPS health first.
Do not create an artificial revision or force a downgrade merely to test.

If an actual update fails, inspect the exact Broker result and:

```bash
sudo systemctl status linux-panel-update.service --no-pager
sudo systemctl status linux-panel-update-recover.service --no-pager
sudo journalctl -u linux-panel-update.service -n 80 --no-pager
```

Do not erase `active-transaction` or overwrite panel state. An unresolved
journal deliberately blocks an ordinary Web boot. Contact the operator
with the pre-update snapshot and logs; do not retry blindly.

## Criteria for marking Issue #35 ready

A reproducible verified commit + passing CI/systemd/QEMU links, a review of
known residual risks, recent **actual production** resource/swap preflight,
snapshot restore capability, an explicit owner decision and a rollback
channel must all be present. Until then the root watcher stays disabled.

This page does not disclose or rely on a private hostname, IP address,
password, token or server-specific certificate configuration.
