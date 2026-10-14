# Linux Panel

以**可理解、可检查、可扩展**为目标的 Linux 管理平台，使用 Node.js ESM + Fastify + Vue 3。业务模块提供 Action，Core 校验与执行，Web UI 独立决定展示。未来可安装 MCP 扩展，但 v0.3 尚不包含 MCP/OAuth。

## v0.3：身份认证与内置设置

- 首次管理员只可通过**服务器本地 CLI** 创建，没有公开注册或默认密码。
- 带盐 scrypt 密码哈希，HttpOnly + SameSite Cookie，服务端会话及权限校验，CSRF 防护、退出、密码更改与会话撤销。
- 内置 Web 面板设置：面板名称、账户安全、会话、审计、只读模块列表。即使没有业务模块也存在。
- 业务模块：`system`（info/memory/cpu）、`storage`（usage）、`services`（list）；Action 都是只读。
- 本地开发固定 Vite 5173，端口被占用时会直接报错而非自动转到 5174。

## 本地验证

```sh
cd ~/Projects/linux-panel
git pull --ff-only origin main
npm ci
npm test
npm run check
npm run build:web
npm run admin:init
```

`admin:init` 仅首次执行，必须在交互式终端中输入密码，勿将密码写入命令参数或聊天。

```sh
npm run dev:api
# 另一个终端
npm run dev:web
```

浏览器访问 <http://127.0.0.1:5173>。如果端口占用，先停止旧的 Vite 实例，避免出现 Origin not allowed。

## 私人公网测试部署

可以用**受支持的 Linux 环境、专用非 root 账号、Nginx HTTPS → `127.0.0.1:4188`、生产 `PANEL_PUBLIC_ORIGIN`、严格代理 IP 与登录速率限制**做私人公网预览。仓库提供：

- `docs/deployment.md`：完整人工部署、无密码检查、备份与回滚流程。
- `docs/security.md`：已具备和未完成的安全边界。
- `deployment/nginx/linux-panel.conf.example`：独立 Nginx 虚拟主机和限流模板。
- `deployment/systemd/linux-panel.service.example`：单实例非 root systemd 模板。
- `deployment/panel.env.example`：环境配置模板。

⚠️ 私人公网预览不是已经通过独立安全审计的正式生产版本；**不要使用过期 CentOS 7、root 运行、无效 HTTPS 证书或绕过登录防护的方式上线**。不要将项目覆盖部署到其他站点目录。v0.4 才开发 MCP/OAuth 可选模块。

更多：[部署](docs/deployment.md) · [安全](docs/security.md) · [架构](docs/architecture.md) · [路线图](docs/roadmap.md)
