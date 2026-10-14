# Linux Panel

**Linux Panel** 是基于 Node.js (Fastify) + Vue 3 的模块化 Linux 管理面板。业务能力统一定义为 Action，Web UI 与可选的 OAuth 保护的 MCP 接口共享这些能力。

*A modular Node.js Linux panel with a web dashboard and an optional OAuth-protected MCP endpoint.*

> v0.5 开发版本：单管理员、单实例，具备 TOTP 双因素认证与受限更新提案；未经过独立安全审计。MCP、新客户端注册和远程更新权限均默认关闭。

## 功能

- 无默认密码的管理员账户、本地初始化、会话、CSRF、可选 TOTP 双因素认证（一次性恢复码）和审计事件。
- 系统、CPU、内存、磁盘及 systemd 服务只读信息。
- Web 页面通过独立展示策略把结构化 JSON 渲染成指标/图表/表格。
- MCP Streamable HTTP（`/mcp`）、OAuth Authorization Code + PKCE、独立客户端权限及撤销。
- Git + systemd + Nginx HTTPS，独立非 root 服务账户。
- **面板更新是标准 Action**：`panel.update.status`（只读）、`panel.update.check`（只读检查）、`panel.update.request`（创建申请），Web 和 MCP 走同一个 Action Engine；后者需 Web 管理员独立确认密码（TOTP 若已启用则额外验证），由受限 systemd Broker 进行实际更新（首次安装须管理员处理）。

## 安装（先预检、修复 BLOCK、再安装）

目标系统：Ubuntu 24.04+ / Debian 12+、systemd >=240、Node.js 24 LTS（最低 22.12+）；共享服务器可使用独立 Node24，不替换 PM2/其他程序的系统 Node。**CentOS 7 不支持自动安装或更新 Broker**。

```bash
# 1. 拉取并检查代码
git clone https://github.com/Ran-ying/linux-panel.git
cd linux-panel

# 2. 只读预检（无证书时先跳过 Nginx）
sudo bash scripts/install.sh --preflight \
  --domain panel-test.example.com --no-nginx

# 3. BLOCK 时：预览修复计划，只有显式 --apply 才修改主机
bash scripts/prepare-host.sh --check
bash scripts/prepare-host.sh --install-node
bash scripts/prepare-host.sh --create-swap 1024
# 如管理员审查确认，才分别执行：
# sudo bash scripts/prepare-host.sh --install-node --apply
# sudo bash scripts/prepare-host.sh --create-swap 1024 --apply

# 4. 用独立 Node24 重新预检
sudo bash scripts/install.sh --preflight \
  --domain panel-test.example.com --no-nginx \
  --node-bin /opt/node24/bin/node
```

**`0 blocker(s)` 只说明满足强制条件，不代表已经安装或达到推荐内存/磁盘要求。** 在用真实域名、有效 TLS 证书与同一套参数完成完整预检后，去掉 `--preflight` 执行正式安装。自动 Nginx 集成使用 `--cert` / `--key`，已有代理用 `--no-nginx` 并**自行完成 HTTPS 与限流接入**；不要用 `panel-test.example.com` 这类占位域名实际部署。

**必读：[完整安装、预检输出说明、BLOCK 修复对应命令、正式安装、手动安装和验收指南](docs/INSTALL.md)**。已部署实例请看 [升级与回滚](docs/UPGRADING.md)；自动更新 Broker 仍须单独验收。


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
