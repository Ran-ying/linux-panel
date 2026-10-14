# Linux Panel

以模块化、可验证、最小权限为目标的 Linux 管理平台：**Fastify + Vue 3 + Auth + Action Engine + 可选 MCP 扩展**。已经完成的 v0.3 是私人的 HTTPS 公网登录面板；v0.4 加入了 OAuth 授权连接和由面板控制的只读 MCP 工具。

> **注意：代码通过 CI ≠ 已经过 ChatGPT 公网端到端验证。** MCP 默认关闭；先在测试/受控环境执行部署与授权测试。当前临时服务器仍是已结束维护的 CentOS 7，需保持迁移计划。

## 能力

- 统一平台身份系统：本地 CLI 初始化的管理员、scrypt 密码、持久会话、Web Cookie、CSRF、服务端权限。
- Web 面板固定存在：概览、账户、面板设置、会话和审计。没有任何业务模块仍能登录和进行基础配置。
- 只读业务 Actions：`system.info`、`system.cpu`、`system.memory`、`storage.usage`、`services.list`。
- **MCP 扩展**：`/mcp` Streamable HTTP、OAuth Authorization Code + PKCE、RFC 9728/RFC 8414 发现、动态公开客户端注册、Bearer Token 和刷新、撤销授权。
- **Web MCP 管理**：总开关、允许注册新客户端、每个工具白名单、每个客户端 Scope 收窄、查看和撤销客户端授权。
- 所有 MCP 操作必须满足：用户权限 ∩ OAuth Scope ∩ Web 工具白名单。默认均不开放，且只读 Action 才有资格暴露；无匿名执行。

## 本地测试

```sh
git pull --ff-only origin main
npm ci
npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund
npm test
npm run check
npm run build:web
```

**新安装才运行一次：** `npm run admin:init`，在交互式终端设置管理员密码。

开发进程分两个终端：`npm run dev:api`、`npm run dev:web`，浏览器 `http://127.0.0.1:5173`。生产环境只运行 Fastify 和已构建的网页。

## 私人公网预览

部署地址 `https://uspanel.rany.ing`，受保护的 MCP 入口 `https://uspanel.rany.ing/mcp`。继续采用宝塔 Nginx HTTPS → `127.0.0.1:4188`，systemd 非 root `linuxpanel` 单实例。

- `docs/deployment.md`：v0.3 的生产部署规范和手工验收。
- **`docs/mcp.md`：v0.4 的依赖安装、OAuth、MCP 权限配置、ChatGPT 接入与回滚。**
- `docs/security.md`：身份、Token、可信代理等安全约束。
- `deployment/`：独立 Nginx、systemd、环境变量示例。

**不要把 MCP 当作公开无认证接口。** 首次连接时应在 Web 设置中明确开启服务和只读工具，临时允许新 OAuth 客户端注册，完成 ChatGPT 授权后关闭注册入口。未认证请求应返回 401；关闭 MCP 则应返回 404。

任何部署到 VPS 的操作需要用户或有服务器权限的 Codex 完成。开发分支未合并前，不得以此说明现有公网环境已实现 MCP。若用户的 ChatGPT 套餐暂不支持自定义 MCP 连接，需按产品可用性要求测试或等待，而不是绕过服务器 OAuth。
