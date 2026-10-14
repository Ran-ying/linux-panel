# Linux Panel

**Linux Panel** 是基于 Node.js (Fastify) + Vue 3 的模块化 Linux 管理面板。业务能力统一定义为 Action，Web UI 与可选的 OAuth 保护的 MCP 接口共享这些能力。

*A modular Node.js Linux panel with a web dashboard and an optional OAuth-protected MCP endpoint.*

> 仍在开发阶段：单管理员、单实例、只读操作为主。未经过独立安全审计。MCP 和客户端注册默认关闭。

## 功能

- 无默认密码的管理员账户、本地初始化、会话、CSRF 和审计事件。
- 系统、CPU、内存、磁盘及 systemd 服务只读信息。
- Web 页面通过独立展示策略把结构化 JSON 渲染成指标/图表/表格。
- MCP Streamable HTTP（`/mcp`）、OAuth Authorization Code + PKCE、独立客户端权限及撤销。
- Git + systemd + Nginx HTTPS，独立非 root 服务账户。

## 安装

目标系统：Ubuntu 24.04 LTS / Debian 12+；推荐 Node.js 24 LTS。**CentOS 7 不受自动安装脚本支持。**

完整的 **手动分步安装** 和 **自动脚本部署** 请看 [docs/INSTALL.md](docs/INSTALL.md)。准备好公网 DNS、Node.js、Git、Nginx 和合法 HTTPS 证书后：

```bash
git clone https://github.com/Ran-ying/linux-panel.git
cd linux-panel
less scripts/install.sh
sudo bash scripts/install.sh \
  --domain panel.example.com \
  --cert /etc/letsencrypt/live/panel.example.com/fullchain.pem \
  --key /etc/letsencrypt/live/panel.example.com/privkey.pem
```

已有独立 TLS 反向代理，可用 `--no-nginx` 安装后手动配置 Nginx/Caddy/宝塔；需要自行完成 OAuth 与登录限流。

本地开发：

```bash
npm ci
npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock
npm run check && npm test && npm run build:web
npm run dev:api
# 新终端运行：npm run dev:web
```

## 项目结构

```text
apps/api/          Fastify API
apps/web/          Vue 3 管理台
core/              Action 注册 / 验证 / 执行
modules/           业务 Action
extensions/mcp/    可选 MCP 与 OAuth
platform/          身份认证 / 权限 / 状态存储 / HTTP 安全
deployment/        systemd / Nginx 模板
scripts/           管理员初始化 / 安装 / 更新
tests/             Node 单元与集成测试
```

更多文档：[架构](docs/architecture.md) · [MCP](docs/mcp.md) · [安装](docs/INSTALL.md) · [升级](docs/UPGRADING.md) · [安全](docs/security.md) · [公开审查](docs/PUBLIC-RELEASE.md)

许可证见 [LICENSE](LICENSE)。请勿把含密码、Cookie、Token 的数据文件推送到 GitHub。
