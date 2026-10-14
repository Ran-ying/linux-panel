# Linux Panel v0.5 threat model

## Assumptions

The adversary can discover the public hostname, read every line of the open-source
repository, enumerate HTTP endpoints, register an OAuth client while registration
is enabled, and send arbitrarily malformed requests from multiple IP addresses.
Knowledge of the domain, source code or scope names is **not** considered secret.

The administrator's password, enrolled TOTP seed, recovery codes, private deploy
key, root-owned broker and pinned GitHub repository are assumed uncompromised.
A compromised administrator session or supply-chain compromise is a separate
incident and may still cause damage. A malicious AI client is not a trusted
person; its claims of approval have no authority.

## Trust boundaries

1. **Internet → Nginx**: TLS, canonical Host, upstream 127.0.0.1 only;
   origin IP rules and separate login/OAuth rate limits. Never trust client-
   supplied X-Forwarded-For without a verified proxy chain.
2. **Browser → Web API**: SameSite HttpOnly cookie, Origin and session CSRF;
   explicit password step-up for updates. TOTP additionally required only when the administrator has opted in.
3. **OAuth Client → MCP**: bearer-only authentication; PKCE, exact registered
   callback, audience-bound tokens and granted scopes. A client name is
   unverified. MCP never treats chat text as user approval.
4. **MCP → Actions**: live policy and OAuth scope checks on tool discovery and
   *again at execution*. Read-only capabilities stay limited to declared
   Actions and strict output schemas.
5. **Shared update Action → Web approval**: Web Session+CSRF or MCP `panel:update` Scope is verified by the respective adapter; one ActionEngine validates input/output. A proposal is not deployment. Approval is a separate Web step-up,
   administrator session, CSRF and password, plus a fresh TOTP when enrolled. Proposal contains only
   a 40-character Git SHA and cannot execute a command.
6. **Web approval → root-owned update broker**: fixed marker file in a private
   directory triggers a systemd one-shot with no variable shell commands.
   The broker allows only fast-forward `origin/main` from an operator-pinned
   GitHub remote. Git/npm/test/build run as `linuxpanel-updater` (not root).
   Root can stop/start only the fixed panel unit and copy private state.
   The original panel process cannot write code or modify the broker.
   A compromised panel process can forge its own approval marker, but still
   cannot choose an arbitrary command, remote, or revision outside the pinned
   trusted upstream head. Code/supply-chain signing is a future hardening area.

## Security requirements and verification

- No anonymous Web Action/MCP tool execution; invalid Origin, CSRF, token,
  client grant or Scope fail closed.
- New tools and updates are disabled by default; turning on update policy
  cannot retroactively increase an existing OAuth token's Scope.
- No arbitrary SSH/root Shell; updating code can only happen via the fixed
  constrained broker after local installation.
- Login rate limits operate by source IP and account; no permanent account lock,
  but 10-minute throttle may be abused for temporary denial of service.
- TOTP replay rejected after successful login. Recovery codes SHA-256 hashed,
  single-use, and shown only once on enrollment. Rebinding increments the
  credential epoch, revoking old OAuth access.
- Update requests are time-limited. The Web user sees old SHA → new SHA and
  must confirm a fresh factor. Failure in test/build/health check restores old
  code, dependencies and backed-up state.
- Git and npm are executed as a separate updater user. **Never add an
  updater-owned path to the root worker's PATH.** Root broker script and systemd
  unit are installed root-owned outside the checkout.
- No credential, raw authorization URL, recovery code, password or TOTP seed
  should be included in logs/PR/Issues.

## Open risks (not covered by v0.5)

No guarantee against unknown parser vulnerabilities, compromised dependencies,
reverse-proxy misconfiguration, TOTP phishing, account recovery compromise,
a compromised GitHub upstream or root host. Single-process JSON persistence,
no multi-user RBAC or independent third-party penetration test. The updater's
first-time provisioning is privileged and requires a manual operator review; the root worker installer refuses systemd < 240 because silent ignoring of filesystem-sandbox directives is unacceptable.
The system is not production-safety certified.

## Tests

- `tests/security-v05.test.js`: TOTP vector, CSRF, setup confirmation,
  one-time recovery and cross-IP throttling.
- `tests/update-controller.test.js`: fixed remote SHA, Web step-up and no
  change to working tree on MCP request.
- `tests/update-mcp.test.js`: real HTTP MCP scope isolation, approval API
  rejection and dynamic revocation.
- Existing OAuth and MCP suites: PKCE replay, callback exact match, token and
  grant revocation, CSP and Origin enforcement.
- CI: Node syntax checks, Bash syntax checks, dependency audits and Vue build.
  A clean-machine privileged broker deployment + rollback drill remains a
  separate **deployment acceptance** task, not a condition to open-source code.
