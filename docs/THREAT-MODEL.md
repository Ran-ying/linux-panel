# Linux Panel threat model — current main (2026-10-16)

v0.5.0 is published; publication is not independent security certification. Current implementation and observed deployments are recorded in PROJECT-STATUS.md and Issue #54.

## Assumptions

Public source, hostnames, endpoints and OAuth scope names are not secrets. Attackers may send malformed requests and register clients while registration is enabled. Administrator credentials, root host, pinned upstream and supply chain are assumed uncompromised; compromise of any is a separate incident.

The supported personal model intentionally trusts an OAuth-authorized client as a whole. Chat text or a claimed client name is never parsed as approval. A valid grant can access newly exposed global read Actions and globally enabled updates; this is not per-tool least privilege.

## Boundaries

1. Internet → operator-managed TLS proxy → loopback panel: canonical Host/Origin, verified forwarded-header chain, application and proxy rate limits. The panel does not provision proxy/TLS/firewall.
2. Browser → Web API: administrator session, HttpOnly/SameSite/Secure cookie, Origin/CSRF, and password/optional TOTP step-up for sensitive platform changes.
3. OAuth → MCP: PKCE S256, exact callbacks, audience-bound tokens, live grant revocation and global policy checked at discovery and execution. Historical scope strings remain for compatibility, not per-tool isolation.
4. Module → ActionEngine: only registered/exposed Actions, input/output schemas, trusted adapter context for existing write policies. Modules are trusted repository code, not sandboxed third-party plugins. JSON presentations cannot grant execution permission.
5. Web-admin command configuration → ordinary terminal execution: fixed module keys, bounded values, private state/audit ID only, non-root service UID, 5 seconds/128 KiB per command, no sudo/root Broker. Custom Shell can mutate data accessible to the service UID; read is intent, not a sandbox. Exact stdout/stderr remain response-only, separate from decoded result. Web exposes raw; current MCP adapter exposes result only.
6. Update proposal/direct enqueue → separately installed root Broker: a proposal requires Web confirmation; direct MCP enqueue is allowed only with global direct-execute policy and an active grant. Both pin the trusted origin/main SHA. Fixed root-owned worker performs unprivileged Git/npm/test/build and constrained deployment/health/rollback; it does not accept arbitrary module commands/remotes/privileged scripts.

A compromised Web process may forge its own update marker, but cannot escape the Broker's pinned source/fixed execution boundary. Upstream code-signing is future work.

## Requirements

- Anonymous or revoked clients cannot execute Actions; invalid Origin/CSRF/token/resource fails closed.
- MCP/registration/high-risk update policies are opt-in; once enabled, global exposed reads intentionally become available to active grants. Revoke the whole grant or disable policy to remove access.
- Write types are denied by default; only implemented proposal-only and exact broker-enqueue paths are allowed by trusted contexts.
- TOTP replay is rejected, recovery codes are hashed and single-use, credential epoch changes invalidate old grants. TOTP is not phishing resistant.
- Root worker/unit are installed root-owned outside the checkout; never place an updater-writable directory in root PATH.
- No tokens, cookies, client IDs, private commands/outputs, authorization URLs or recovery secrets in public logs, commits, screenshots or Issues.
- Confirm durable update SHA/status and service health; queued is not success.

## Verification and limits

Registry/engine, command migration/raw-output, Web API/CSRF, OAuth/MCP global policy/revocation, renderer schema rejection, responsive/PWA and update recovery tests run in CI. Ordinary Linux CI exercises terminal defaults. Test VPS Broker deployment and MCP updates have observed successful results; see Issue #54 for exact SHAs.

No multi-user RBAC, distributed persistence, untrusted plugin isolation or independent third-party penetration test. No guarantee against compromised upstream/root, parser defects, proxy mistakes, phishing or resource exhaustion. Root Broker requires supported systemd (at least 240); platform/real-device QA coverage must be stated from actual evidence.

[Security](security.md) · [Module contract](MODULE-DEVELOPMENT.md) · [Updater](UPDATER.md)
