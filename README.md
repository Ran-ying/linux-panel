# Linux Panel

**Linux Panel** 是基于 Node.js (Fastify) + Vue 3 的模块化 Linux 管理面板。业务能力统一定义为 Action，Web UI 与可选的 OAuth 保护的 MCP 接口共享这些能力。

*A modular Node.js Linux panel with a web dashboard and an optional OAuth-protected MCP endpoint.*

> v0.5 开发版本：单管理员、单实例，具备 TOTP 双因素认证与受限更新提案；未经过独立安全审计。MCP、新客户端注册和远程更新权限均默认关闭。

## 功能

- 无默认密码的管理员账户、本地初始化、会话、CSRF、可选 TOTP 双因素认证（一次性恢复码）和审计事件。
- 系统、CPU、内存、磁盘及 systemd 服务只读信息。
- Web 页面通过独立展示策略把结构化 JSON 渲染成指标/图表/表格。
- MCP Streamable HTTP（`/mcp`）、OAuth Authorization Code + PKCE、独立客户端权限及撤销。
- Git + systemd + 独立非 root 服务账户。只提供可配置的 HTTP 监听端口，Nginx/Caddy/HTTPS/防火墙完全由管理员自行管理。
- **面板更新是受限 Action**：`panel.update.status`（Web/MCP 可授权只读）、`panel.update.check`（Web 只读检查）、`panel.update.request`（Web/MCP 申请，需 Web 管理员审批）、`panel.update.execute`（MCP 独立高权限直接排队）。Web 也支持核对 SHA 后一次确认。MCP 直接执行必须显式开启独立策略并重新授权 `panel:update:execute`，旧只读/申请授权不会自动升级；所有执行仍经隔离 systemd Broker，真实更新与故障回滚验收未完成前默认关闭。

## 安装（不依赖 Nginx）

默认只监听 `127.0.0.1:4188`。安装器只管理自己的 Node 服务和 systemd，不检查、安装、修改或重载 Nginx、证书、DNS 与防火墙；可使用任何自管反向代理，也可以通过 SSH 隧道在本机访问。

```bash
git clone https://github.com/Ran-ying/linux-panel.git
cd linux-panel

# 先只读预检，不做任何安装
sudo bash scripts/install.sh --preflight --host 127.0.0.1 --port 4188 \
  --node-bin /opt/node24/bin/node

# 0 BLOCK 且审查全部 WARN 后，明确执行首次安装
sudo bash scripts/install.sh --host 127.0.0.1 --port 4188 \
  --node-bin /opt/node24/bin/node
```

自定义端口：`--port 4888`。监听所有 IPv4 接口：`--host 0.0.0.0`，但必须提供 `--public-origin https://your-real-domain` 并自行管理外部 HTTPS 与网络防火墙；**不要将原始 HTTP 端口直接暴露到公网**。已经有 Nginx、Caddy、Traefik 等服务无需为面板修改现有代理。

**Web Action**：`panel.listener.status` 可查看当前监听配置；`panel.listener.request` 可申请更改监听地址和端口，Web 管理员输入密码（启用 TOTP 时需验证码）确认后保存，下一次**显式重启面板**才生效。不会自动重启或改动代理。

**首次安装若在 npm 测试/构建阶段中断**，不要删除 `/opt/linux-panel`，也不要直接重新运行正常安装。先核查没有管理员状态和服务，将两个 checkout 都安全 fast-forward 更新到修复版本后，使用 `sudo bash scripts/install.sh --resume --preflight ...` 检查，再明确执行 `sudo bash scripts/install.sh --resume ...`；详见安装指南 4.4。

**可选受限更新 Broker** 与面板首次安装解耦。已安装后使用 `sudo bash scripts/install-update-broker.sh --check` 只读预检；`--apply` 安装后仍保持禁用；`--verify` 只读检查有效沙箱与权限。通过隔离测试机的更新/回滚验收后才能显式 `--activate --ack-acceptance`。参见 [Broker 安装指南](docs/UPDATER.md)，不要在未验收的生产机上激活。

遇到 Node.js 18 / 内存不足等 BLOCK 时，先预览 `bash scripts/prepare-host.sh --check`、`--install-node`、`--create-swap 1024`，只有明确加 `--apply` 才修改主机。**[完整预检、报错修复、自动安装、手动安装与验收指南](docs/INSTALL.md)**。CentOS 7 不受此安装与 root Broker 支持；自动更新 Broker 尚须单独验收。


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

更多文档：[更新验收清单](docs/UPDATE-ACCEPTANCE.md) · [架构](docs/architecture.md) · [MCP](docs/mcp.md) · [安装](docs/INSTALL.md) · [升级](docs/UPGRADING.md) · [安全](docs/security.md) · [威胁模型](docs/THREAT-MODEL.md) · [MCP 更新器](docs/UPDATER.md) · [公开审查](docs/PUBLIC-RELEASE.md)

许可证见 [LICENSE](LICENSE)。请勿把含密码、Cookie、Token 的数据文件推送到 GitHub。
