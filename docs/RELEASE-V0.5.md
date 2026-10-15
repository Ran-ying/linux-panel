# Linux Panel v0.5.0 — acceptance draft

**Draft: stable publication is pending the unchecked acceptance items below.** This draft does not claim physical-device testing, independent security audit or owner snapshot restoration.

## Changes

- Shared modular ActionEngine for authenticated Web and optional OAuth PKCE MCP; single administrator and optional TOTP/recovery codes.
- Trusted-client global MCP exposure; whole-client revocation, explicit policy and fixed Broker checks. No per-update Web click when direct MCP updates are explicitly enabled.
- Restricted root-owned systemd update Broker: exact trusted origin/main SHA, isolated updater identity, state backup, health check and rollback/recovery.
- Light/dark/system appearance, responsive module dock, installable PWA and public-static-only offline fallback.
- Read-only inherited Git ACLs compatible with RestrictSUIDSGID; consecutive updates and fresh-install cross-UID regressions covered.
- Guided install CLI with preflight, preview, explicit confirmation and unattended password stdin. No automatic MCP/Broker activation or changes to proxy/TLS/firewall.
- Chromium acceptance at 320/390/730/1280px, disposable complete Ubuntu installation/login, production audits and full-history credential scanning.

## Installation and operations

Start with [INSTALL.md](INSTALL.md). Use [UPGRADING.md](UPGRADING.md) for existing instances; do not overwrite private state with the first-install helper. Broker installation and activation are separate opt-ins in [UPDATER.md](UPDATER.md). Installed immutable root workers require separate operator migration when their bytes change.

Verified full application installation: Ubuntu 24.04. Debian 12 is an intended supported target whose complete install still needs acceptance. Node 24 is recommended. Check disk/RAM/swap preflight; resource recommendations are not performance guarantees.

## Known limitations and publication checklist

- [ ] Real iPhone Safari and Android Chrome home-screen installation, standalone login, keyboard and safe-area review.
- [ ] Complete Debian 12 installation.
- [ ] Owner snapshot restore/console recovery acceptance.
- [ ] Owner decision on existing public historical private-host metadata. Current tracked source has no matching private hostname; no history rewrite was performed.
- [ ] Independent security/release review and final issue triage.
- [ ] Review exact release SHA, green CI, stage-by-stage test-server deployment results and final publication decision.

PWA viewport zoom restriction was expressly requested and may reduce accessibility. Offline mode is a static reconnect explanation; it cannot administer the server or serve cached private API data. There is no multi-admin RBAC, generic root shell, SSO or independent security certification.

Evidence index: [PUBLIC-RELEASE.md](PUBLIC-RELEASE.md), [PROJECT-STATUS.md](PROJECT-STATUS.md), [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54), and [release plan](V0.5-RELEASE-PLAN.md). Do not equate a draft, green build, queued update, successful deployment and complete stable-release acceptance.
