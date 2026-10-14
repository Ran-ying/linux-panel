# Linux Panel v0.4 — MCP 与 OAuth 实现

## 用户接入目标

- 公网 HTTPS：`https://uspanel.rany.ing/mcp`，通过现有宝塔 Nginx → 单一 Fastify 进程 `127.0.0.1:4188`。
- Web 面板和 Auth 基础用户系统不变。OAuth Authorization Code + PKCE S256 是 MCP 独有的客户端连接方式。
- MCP 默认 **disabled**，所有 MCP Actions 默认 **不公开**，并且所有新客户端注册默认 **disabled**。即使公开端点可达，未携带有效 Bearer Token 也只能收到 401。
- v0.4 仅允许业务模块中声明 `exposure.mcp=true` 的只读 Action。未允许的 Action 不出现在 `tools/list`，也不能执行。后台的授权校验永远覆盖 Web UI 的显示状态。
- 现有 Actions：`system.info`、`system.cpu`、`system.memory`、`storage.usage`、`services.list`。
- 工具权限是 **用户权限 ∩ 客户端 OAuth Scope ∩ 全局 MCP Action 白名单**。面板 Settings 中可关闭工具、缩小某个客户端的 Scope、撤销整个授权；关闭之后后端立即重新检查。
- 授权使用平台 Auth 账号和网页登录 Cookie 完成，但 /mcp **不接受 Web Cookie**，只接受 OAuth Bearer Token。

## 客户端 OAuth 功能

- 受保护资源发现：`/.well-known/oauth-protected-resource/mcp`。
- Authorization Server 发现：`/.well-known/oauth-authorization-server`。
- 公开客户端注册：`POST /oauth/register`，要求管理员先临时打开「允许新客户端注册」。
- 用户授权：`GET /oauth/authorize`，已登录会话或跳转登录，明确显示 **未经验证**的客户端名称、回调来源和权限；`POST /oauth/authorize` 接受同源 CSRF 保护的授权/拒绝。
- Token：`POST /oauth/token`，必须提供精确的 `resource=https://uspanel.rany.ing/mcp`。刷新、撤销以及修改账户密码后的 Token 失效均已实现。
- Scope：`system:read`、`storage:read`、`services:read`，以及用于长期连接、**不代表业务 Action 权限**的 `offline_access`。
- 动态客户端注册 RFC 7591 路径受总量限制、独立开关、每 IP 短时限流。它对匿名公网仍存在潜在流量攻击，需要 Nginx 额外限流。
- **尚未支持 OAuth Client ID Metadata Documents（CIMD）**。某些 2026 新客户端优先使用 CIMD；若客户端不支持 DCR、且没有预注册方式，可能无法直接完成连接。必须实际联调，不能假设完全兼容。

## 模块安装与生产部署

`extensions/mcp` 是可独立关闭的可信扩展，和 `modules/` 中的业务 Action 不同。使用 MCP SDK v2 + Node HTTP adapter + @node-oauth/oauth2-server：

```sh
npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund
```

根仓库原有依赖仍然通过 `npm ci` 安装。不要在资源紧张的 CentOS 7 VPS 上直接运行完整前端构建；优先 GitHub CI 或其他 Linux 构建环境完成打包，并由 Codex 执行环境审查、备份和可回滚发布。

生产环境必须保留 `NODE_ENV=production`、`PANEL_PUBLIC_ORIGIN=https://uspanel.rany.ing`、`PANEL_DATA_DIR=/var/lib/linux-panel`。不能覆盖账号 JSON 或新建管理员。Nginx 应反代 /mcp、/oauth/*、/.well-known/* 到现有 Fastify，特别对 /oauth/register、/oauth/token 加上独立速率限制。Cloudflare 边缘 IP 要在 Nginx 通过可信代理白名单正确恢复用户 IP，不得相信公网伪造 X-Forwarded-For。当前 Node 监听地址仍仅为 127.0.0.1。

## 设置与授权步骤

1. 用户正常登录 Linux Panel Web 管理页面，打开「面板设置 → MCP 扩展」。
2. 打开 MCP 总开关，**先仅勾选 system.info/system.cpu/system.memory/storage.usage**；建议初始不开放 services.list。
3. 准备添加 ChatGPT 连接时，短暂打开「允许新 OAuth 客户端注册」，保存。
4. 在有资格创建自定义 MCP 应用的 ChatGPT 界面配置 `https://uspanel.rany.ing/mcp`，发起 OAuth；留意用户登录后的回调地址、客户端身份提示和 Scope。
5. 认证成功后，关闭新客户端注册开关，避免其他人继续注册客户端。旧客户端凭证不会因关闭注册开关失效。
6. 对话中让 ChatGPT 读取 CPU、内存、磁盘信息。之后测试 Web 设置中关闭工具、缩小 Scope 和撤销授权，确保 ChatGPT 不再能调用相应工具。
7. 失败时关闭 MCP 总开关，不要禁用已有 Web 登录或修改 v0.3 数据文件。

**注意：GitHub CI 只验证本地模拟及真实 HTTP 测试环境；ChatGPT 连接能力取决于账户/工作区可用功能和客户端实现。公网端到端联调仍需单独完成。**

## 状态和恢复

新 OAuth 客户端、授权和 Token 哈希会和已有用户账号一同保存在私有 `panel-state.json`。上线前和回滚前使用非 root 权限进行安全备份。代码升级保持兼容 v0.3 的原状态结构，MCP 无配置时默认关闭。密码更改会令旧 MCP Token 无效。v0.4 的安全审计不会取代 CentOS 7 的系统风险评估。
