# Linux Panel development milestones

**Current priority (2026-10-15): ship a reproducible, secure public v0.5 release before extending privileged server Actions.** See the actionable [v0.5 release execution plan](V0.5-RELEASE-PLAN.md), [current project status](PROJECT-STATUS.md) and [Issue #54 handoff](https://github.com/Ran-ying/linux-panel/issues/54). Version tags are not implied by feature completion.

## Completed capabilities (not a final release signoff)

- **v0.1:** Fastify + Vue + ActionEngine.
- **v0.2:** structured modules, schema validation and independent UI presentation policies.
- **v0.3:** authenticated Web console, CSRF, sessions, audit and reverse-proxy deployment.
- **v0.4:** optional MCP and OAuth PKCE. The current trusted personal MCP mode uses an authenticated client grant plus globally controlled exposed Actions; historical per-client scope restrictions are not the current behavior.
- **v0.5 implementation milestones already validated:** optional TOTP/recovery, account throttling, Web/MCP shared update Actions, independently installed immutable root-owned systemd Broker, restricted origin/main SHA update, rollback, dark/light/system themes and responsive PWA. Disposable systemd acceptance and successive real MCP production updates have passed. **This does not itself approve v0.5 public release.**

## v0.5 release readiness — ordered gates

1. **Mobile/PWA device QA:** browser responsive review plus genuine iPhone/Android home-screen, safe-area, keyboard, offline/privacy, theme and navigation checks. Record unknown hardware coverage honestly.
2. **First-time install UX:** simplify the supported Ubuntu/Debian setup path; preserve separate read-only preflight, app install, opt-in privileged Broker installation, explicit activation and explicit MCP direct-execute authorization. Verify cross-UID Git ACL behavior before/after a real update in disposable environments. Track [Issue #22](https://github.com/Ran-ying/linux-panel/issues/22).
3. **v0.5 release gate:** full-history secret audit, dependency/license/security checks, documentation refresh, repeatable clean install/upgrade/uninstall and rollback/recovery, threat-model review and owner signoff. Reconcile open [#14](https://github.com/Ran-ying/linux-panel/issues/14), [#23](https://github.com/Ran-ying/linux-panel/issues/23) and [#35](https://github.com/Ran-ying/linux-panel/issues/35) with actual evidence before closing them.

## After public v0.5

- **v0.6:** bounded server operations via explicit allowlisted Actions and a restricted privilege broker. Prioritize read-only service/log diagnostics, then narrowly permitted restarts with confirmation and audit; **never** expose a generic root shell. A trusted OAuth client can discover newly globally enabled exposed MCP tools, so gate new privileged capabilities deliberately.
- **v1.0:** installation/upgrade/recovery experience proven across supported platforms, independent security verification, stable compatibility contract and maintained release documentation.

## Execution route

- **Codex Cloud:** repo implementation, bug fixes, tests, CI and reviewable feature PRs.
- **ChatGPT Work:** browser-oriented release QA, coordination of cross-app evidence, documentation/release deliverables. It cannot replace real iOS/Android device testing.
- **ChatGPT + operator:** gate review, cross-agent sequencing, trusted PR/CI checks and explicitly authorized production MCP updates verified through persisted result + live service health.

**Publication is not release certification.** A GitHub merge, passing CI, update `queued` receipt or successful deployment is not by itself an acceptance of the remaining release gates. Root-owned Broker remains a separately installed and explicitly activated component.
