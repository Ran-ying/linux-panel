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
- Write types are denied by default; implemented proposal-only, exact broker-enqueue and terminal.execute user-shell paths require trusted contexts. The terminal capability runs only under the existing non-root service UID, and is available to valid trusted MCP grants when its module exposes it. It never grants root/Broker access.
- TOTP replay is rejected, recovery codes are hashed and single-use, credential epoch changes invalidate old grants. TOTP is not phishing resistant.
- Root worker/unit are installed root-owned outside the checkout; never place an updater-writable directory in root PATH.
- No tokens, cookies, client IDs, private commands/outputs, authorization URLs or recovery secrets in public logs, commits, screenshots or Issues.
- Confirm durable update SHA/status and service health; queued is not success.

## Verification and limits

Registry/engine, command migration/raw-output, Web API/CSRF, OAuth/MCP global policy/revocation, renderer schema rejection, responsive/PWA and update recovery tests run in CI. Ordinary Linux CI exercises terminal defaults. Test VPS Broker deployment and MCP updates have observed successful results; see Issue #54 for exact SHAs.

No multi-user RBAC, distributed persistence, untrusted plugin isolation or independent third-party penetration test. No guarantee against compromised upstream/root, parser defects, proxy mistakes, phishing or resource exhaustion. Root Broker requires supported systemd (at least 240); platform/real-device QA coverage must be stated from actual evidence.

[Security](security.md) · [Module contract](MODULE-DEVELOPMENT.md) · [Updater](UPDATER.md)

## Interactive PTY boundary

The Web PTY is a panel-owned transport, bound to the creating authenticated session, with Origin/CSRF on writes and live session checks on output. Revocation/idle/absolute lifetime and app shutdown clean up sessions; buffers/connections are bounded. Commands/output stay in response or memory, not persistent history/audit payloads. Python 3 PTY and xterm provide a real terminal; arbitrary commands may still mutate service-accessible data or launch their own background processes. This is not OS isolation.

## 可选 root 文件管理的信任边界（Issue #111）

启用 PrivilegedActionClient 的管理员明确授予整个 linuxpanel OS 身份调用固定 root 文件 handlers 的能力。同 UID 终端/PTY/自定义 collectors 不构成隔离；可信 MCP 终端也能构造 socket 请求。文件 Web-only policy 并非操作系统权限隔离。root 系统文件编辑可间接修改运行代码、计划任务或启动配置，因此是广泛 root 管理权限，不宣称是对恶意终端的沙箱。

独立 root 服务只接受注册 Action 与独立输入校验，不提供 root Shell/动态模块加载。安装包和依赖 root-only，安装命令由 root 操作员显式执行，更新 Broker 不安装或运行任意新 root 脚本。未配置 root 通道时普通模式；配置后服务不可用返回 503，不静默降级。Web 会话/CSRF/Origin、根端结构验证、未知 Action 拒绝、Unix socket OS 访问控制各自保留。根端审计只记录 Action ID、成功/错误码。
