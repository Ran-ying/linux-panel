# v0.5 public release checklist

**Owner decision, 2026-10-15:** publication is explicitly approved with the documented limitations. Unchecked testing/review items below remain follow-up work; they must not be reported as passed. This decision supersedes the earlier draft-only publication hold.

The repository is already public. Visibility does not establish release readiness. Private deployment information must never be added to new commits, issues, artifacts or CI logs. `package.json private: true` only prevents npm publishing.

## Verified evidence (2026-10-15)

- [x] PR #73: Chromium 320/390/730/1280px, all modules, theme persistence, login/logout and public-only Service Worker cache/offline/reconnect. Exact merged-main CI 38762271116 passed.
- [x] PR #74: guided installation and bounded password stdin. Disposable Ubuntu 24.04 full installation, actual systemd service/password login, repeat-install refusal and private configuration permissions passed (38762742885 and 38762905226).
- [x] Production dependency audit: app 96 production dependencies and optional MCP extension 16 production dependencies, 0 reported vulnerabilities at audit time. This is a point-in-time advisory check.
- [x] Gitleaks 8.30.1 checksum verified; local all-fetched-ref scan: 360 commits inspected, 0 findings. Full-history CI scans all fetched branch/tag refs; neither result proves credentials can never exist.
- [x] Main production license inventory: MIT 75, BSD-3-Clause 6, BSD-2-Clause 1, ISC 6, BlueOak-1.0.0 5; the Vue workspace is covered by the repository MIT license. Retain dependency notices when distributing.
- [x] Current checked-out tracked files contain no private deployment hostname; a separate metadata-only history check found historical private-host identity in seven unique old blobs. No values are reproduced here.
- [x] Owner accepted release with the disclosed historical private-host metadata retained. Do not rewrite live deployed Git history as an automatic cleanup: the Broker requires compatible trusted main ancestry. Any history migration needs a separate operator plan.
- [ ] Real iPhone and Android home-screen installation, keyboard/safe areas and launch UX.
- [ ] Full Debian 12 installation; Ubuntu evidence does not establish Debian parity.
- [ ] Operator snapshot restoration/console recovery acceptance. Disposable systemd and QEMU fault tests do not prove the owner's host snapshot restores.
- [ ] Independent security review and issue triage (#14/#22/#23/#35).
- [ ] Exact release-candidate CI/build, release notes, supported-platform/known-limitation review and final release decision.

## Release control

Follow [V0.5-RELEASE-PLAN.md](V0.5-RELEASE-PLAN.md), [PROJECT-STATUS.md](PROJECT-STATUS.md), [UPDATER.md](UPDATER.md) and [PRODUCTION-DEPLOYMENT-GATE.md](PRODUCTION-DEPLOYMENT-GATE.md). Source merged, CI passed, successful test-server deployment, physical-device acceptance and public release are separate states.

The owner approved stable v0.5 publication while retaining the known gaps. A published release records that acceptance decision, not a claim that all testing and independent review are complete. No root worker changes, forced Git history replacement, service disruption or snapshot experiments belong in a public-release documentation task.

MCP uses the owner-approved trusted-client model: OAuth authorizes whole-client login, explicitly exposed read tools and globally enabled update Actions; whole-client revocation and independent Broker checks remain. TOTP is optional and already implemented. Reverse proxies/TLS/firewalls are operator-managed, outside the installer.
