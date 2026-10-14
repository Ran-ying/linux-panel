# Linux Panel Roadmap

- **v0.3** — Auth、内置 Web 设置、原有只读业务 Action；HTTPS 私人公网预览部署完成。
- **v0.4.1（当前开发）** — 可选 MCP 传输扩展、禁用为默认、Web 设置内的 Action 级别白名单。OAuth 未完成之前 `/mcp` 必须返回 401，禁止匿名读取主机信息。
- **v0.4.2（待实现）** — OAuth Authorization Code + PKCE、可信客户端登记、RFC 9728/RFC 8414 发现、绑定 /mcp 资源的 Token、现有 Auth 用户登录及授权确认。
- **v0.4.3（待实现）** — Web 客户端授权列表、Scope 逐项配置、撤销授权即时生效、MCP 工具暴露策略服务端检查。
- **v0.4.4（待联调）** — MCP Inspector / ChatGPT 的真实 OAuth、工具发现与只读调用测试，含 Nginx/CDN。
- **v0.5+** — 安全审计后逐渐添加其他模块及高级 Web 页面。

原则：MCP 必须是独立、可禁用的传输扩展，用户身份只由平台 Auth 提供；MCP OAuth 必须与 Web Cookie 分离；Token Scope ∩ 用户权限 ∩ 工具白名单方可执行。新增 Action 默认不暴露，禁止匿名高权限工具。
