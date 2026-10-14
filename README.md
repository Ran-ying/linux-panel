# Linux Panel

以**可理解、可检查、可扩展**为目标的 Linux 管理面板。JavaScript ES Modules + Fastify + Vue 3；模块拥有 Action、Web/MCP 共用能力和数据。

> **v0.2 本地只读原型。没有身份认证和 MCP 服务，禁止公网公开。**

## 核心边界

- **Action**（`modules/<id>/actions/`）：定义操作、输入输出 JSON Schema、数据来源和执行逻辑，不声明图标、按钮、图表或刷新频率。
- **Core**（`core/`）：操作注册、输入和输出校验、执行；目前仅允许可信只读 Action。
- **Web UI**（`modules/<id>/ui/presentations.js` + `apps/web/`）：决定使用指标卡、进度条还是表格，原始 JSON 随时可见；可手动开启自动刷新。
- **MCP**：未来以适配器方式注册工具，使用同一个 Action 返回的 JSON，**不读取 Web UI 配置**。

## 包含的只读 Action

- `system.info`：主机、平台、内存总量、运行时间等。
- `system.memory`：Linux 的 MemAvailable，macOS 时展示估算提示。
- `system.cpu`：短时间 CPU 忙碌率采样。
- `storage.usage`：根文件系统的容量、可用量、使用率。
- `services.list`：Linux systemd 列表，macOS 返回明确标注的模拟服务。

Action 输出被验证为结构化 JSON。UI 配置通过单独的 `GET /api/web/presentations` 返回；`GET /api/actions` 则只公开能力元数据。这两份内容**不会混在一起**。

自动刷新是 Web 的可选策略，默认关闭。页面隐藏、操作切换、页面卸载时暂停或停止。刷新调用的是同一只读 Action；不产生服务器后台定时任务。

## MacBook 本地开发

需要 Node.js 22.12+ 或 24：

```bash
cd ~/Projects/linux-panel
npm ci
npm test
npm run check
npm run build:web
```

两个终端分别运行：

```bash
npm run dev:api
# 另一个终端
npm run dev:web
```

浏览器访问 <http://127.0.0.1:5173>。此时得到的是**MacBook 本机数据，不是 VPS 数据**。开发时 Vite 和 Fastify 各一个进程；正式构建后由 Fastify 托管静态资源，可以一个 PM2 进程运行后端。

## 安全要求

当前 API 无登录、会话、服务器侧权限验证和独立审计，不可经 Nginx/Cloudflare 或公网 TCP 端口暴露。MCP 尚未实现；`exposure.mcp` 只表示未来支持。不要提交 Token、密码、.env、私有文件或数据库备份。

更多：[架构](docs/architecture.md) · [安全](docs/security.md) · [部署](docs/deployment.md) · [路线图](docs/roadmap.md)
