# Linux Panel

**Linux Panel** 是基于 Node.js (Fastify) + Vue 3 的模块化 Linux 管理面板。业务能力统一定义为 Action，Web UI 与可选的 OAuth 保护的 MCP 接口共享这些能力。

*A modular Node.js Linux panel with a web dashboard and an optional OAuth-protected MCP endpoint.*

> [v0.5.0 已发布](https://github.com/Ran-ying/linux-panel/releases/tag/v0.5.0)。main 持续迭代，当前功能和测试/部署证据见 [项目当前状态](docs/PROJECT-STATUS.md)、[Issue #54](https://github.com/Ran-ying/linux-panel/issues/54)。发行不代表独立安全审计或 v1.0 稳定性认证。

## 功能

- 无默认密码的管理员账户、本地初始化、会话、CSRF、可选 TOTP 双因素认证（一次性恢复码）和审计事件。
- [文件管理](docs/FILES.md)：目录浏览、MB 大小、权限/所有者、UTF-8 编辑、新建、重命名、删除和拖拽上传，复用面板服务账户权限。
- 两个系统 Action：资源使用情况（system.resources，含 CPU/内存/磁盘）与基本信息（system.info）；另有 services.list（名称关键词、运行状态与子状态组合筛选）。旧拆分 Action 已移除。
- 终端模块：一个 terminal.execute Action 支持 Web/MCP 带参数命令执行；下方真实 PTY 黑色终端支持目录保持与交互，仅普通服务账户。
- 模块导航顺序持久化，默认系统概览 → 服务浏览 → 终端 → 文件管理；后续新增模块追加末尾。
- 模块通过声明式配置复用面板指标、进度条、表格和组合分区；统一命令编辑/保存与原始输出/JSON，无需模块 CSS 或前端业务特判。
- MCP Streamable HTTP（`/mcp`）、OAuth Authorization Code + PKCE、可信客户端整体授权、全局工具策略及即时撤销。
- Git + systemd + 独立非 root 服务账户。只提供可配置的 HTTP 监听端口，Nginx/Caddy/HTTPS/防火墙完全由管理员自行管理。
- 支持浅色/深色/跟随系统的外观切换与响应式移动页面，可通过 PWA 清单添加到手机主屏幕；真实 iOS/Android 设备兼容性仍属于 v0.5 发布验收的一部分。
- **面板更新是受限 Action**：`panel.update.status`（Web/MCP 可授权只读）、`panel.update.check`（Web 只读检查）、`panel.update.request`（Web/MCP 申请，需 Web 管理员审批）、`panel.update.execute`（MCP 独立高权限直接排队）。Web 也支持核对 SHA 后一次确认。**个人可信 MCP 模式**下，OAuth 登录只负责客户端身份授权：已连接的客户端自动看到注册为 MCP 的只读 Action，以及面板全局开启的申请/直接更新 Action；不再逐客户端、逐工具分配 Scope。直接更新仍须独立开启全局策略与已激活的隔离 systemd Broker，且仅允许可信 origin/main SHA；关闭策略或撤销客户端后立即失效。此能力并非默认对所有新安装开放，也不意味着已完成独立安全审计。

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

模块开发先读 **[面板优先的模块开发规范（含复制示例）](docs/MODULE-DEVELOPMENT.md)**。变更契约必须同步当前文档和升级说明；旧过程归档 docs/history。

更多文档：[更新验收清单](docs/UPDATE-ACCEPTANCE.md) · [架构](docs/architecture.md) · [MCP](docs/mcp.md) · [安装](docs/INSTALL.md) · [升级](docs/UPGRADING.md) · [安全](docs/security.md) · [威胁模型](docs/THREAT-MODEL.md) · [MCP 更新器](docs/UPDATER.md) · [v0.5 发布执行计划](docs/V0.5-RELEASE-PLAN.md) · [路线图](docs/roadmap.md) · [公开审查](docs/PUBLIC-RELEASE.md)

许可证见 [LICENSE](LICENSE)。请勿把含密码、Cookie、Token 的数据文件推送到 GitHub。
