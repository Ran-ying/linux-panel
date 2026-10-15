# Linux Panel v0.5.0

**Release approved by the project owner on 2026-10-15.** The owner accepted publication with the known limitations below. Physical-device testing, independent security audit and owner snapshot restoration are not claimed.

## Changes

- Shared modular ActionEngine for authenticated Web and optional OAuth PKCE MCP; single administrator and optional TOTP/recovery codes.
- Trusted-client global MCP exposure; whole-client revocation, explicit policy and fixed Broker checks. No per-update Web click when direct MCP updates are explicitly enabled.
- Restricted root-owned systemd update Broker: exact trusted origin/main SHA, isolated updater identity, state backup, health check and rollback/recovery.
- Light/dark/system appearance, responsive module dock, installable PWA and public-static-only offline fallback.
- Read-only inherited Git ACLs compatible with RestrictSUIDSGID; consecutive updates and fresh-install cross-UID regressions covered.
- Guided install CLI with preflight, preview, explicit confirmation and unattended password stdin. No automatic MCP/Broker activation or changes to proxy/TLS/firewall.
- Chromium acceptance at 320/390/730/1280px, disposable complete Ubuntu installation/login, production audits and full-history credential scanning.

## Installation and operations

Start with [INSTALL.md](https://github.com/Ran-ying/linux-panel/blob/main/docs/INSTALL.md). Use [UPGRADING.md](https://github.com/Ran-ying/linux-panel/blob/main/docs/UPGRADING.md) for existing instances; do not overwrite private state with the first-install helper. Broker installation and activation are separate opt-ins in [UPDATER.md](https://github.com/Ran-ying/linux-panel/blob/main/docs/UPDATER.md). Installed immutable root workers require separate operator migration when their bytes change.

Verified full application installation: Ubuntu 24.04. Debian 12 is an intended supported target whose complete install still needs acceptance. Node 24 is recommended. Check disk/RAM/swap preflight; resource recommendations are not performance guarantees.

## Known limitations and follow-up work

- [ ] Real iPhone Safari and Android Chrome home-screen installation, standalone login, keyboard and safe-area review.
- [ ] Complete Debian 12 installation.
- [ ] Owner snapshot restore/console recovery acceptance.
- [x] Owner accepted publication with existing public historical private-host metadata on 2026-10-15. Current tracked source has no matching private hostname; no history rewrite was performed.
- [ ] Independent security/release review and final issue triage.
- [x] Owner reviewed the reported green CI, four successful staged test-server deployments and outstanding limitations, and explicitly approved v0.5 publication on 2026-10-15.

PWA viewport zoom restriction was expressly requested and may reduce accessibility. Offline mode is a static reconnect explanation; it cannot administer the server or serve cached private API data. There is no multi-admin RBAC, generic root shell, SSO or independent security certification.

Evidence index: [PUBLIC-RELEASE.md](https://github.com/Ran-ying/linux-panel/blob/main/docs/PUBLIC-RELEASE.md), [PROJECT-STATUS.md](https://github.com/Ran-ying/linux-panel/blob/main/docs/PROJECT-STATUS.md), [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54), and [release plan](https://github.com/Ran-ying/linux-panel/blob/main/docs/V0.5-RELEASE-PLAN.md). Publication is an owner decision; the unchecked follow-up items remain unverified and must not be described as passed.
