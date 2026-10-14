# Linux Panel development milestones

- v0.1: Fastify + Vue + Action Engine — complete.
- v0.2: structured modules, schema validation and presentation policies — complete.
- v0.3: authenticated Web console, CSRF, sessions, audit and reverse proxy — complete.
- v0.4: optional MCP + OAuth PKCE, per-client scopes and runtime allowlist — **verified with real ChatGPT read-only MCP calls**.
- v0.5 (in development): TOTP and recovery codes, account-level throttling, threat-model tests, a **shared update Action** callable from Web and MCP, gated by OAuth scope (MCP) or Session+CSRF (Web), plus independent Web password confirmation (TOTP required only when enabled), and a separately installed, fixed systemd update broker.
- v0.6: restricted operations broker; no generic root shell; explicit approval for destructive actions.
- v1.0: clean-environment installation, upgrade and rollback validation, independent security testing and stable docs.

**Do not confuse GitHub Public visibility with a production-ready release.**
An MCP update proposal is not an update execution. The privileged worker must be installed and tested once by a local operator; it does not accept arbitrary shell commands or remotes.
