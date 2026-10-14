# Linux Panel

一个以**可理解、可检查、可扩展**为目标的 Linux 管理面板。使用 JavaScript ES Modules、Fastify、Vue 3，以及模块拥有 Action、Web/MCP 共享执行的架构。

> **当前阶段：v0.1 本地只读原型，尚不具备生产环境所需的认证与权限防护。不要暴露到公网。**

## 项目原则

1. **模块拥有操作（Module-owned Actions）**：操作定义和实现放在 `modules/<模块>/actions/`。
2. **统一发现**：Web 和未来 MCP 适配器都从 `ActionRegistry` 获取同一份操作元数据。
3. **共享执行**：两个入口使用同一个 `ActionEngine`，不重复实现业务逻辑。
4. **透明性**：每个 Action 描述其 Linux 原理、参数和只读操作预览。
5. **权限隔离**：未来需要特权的系统操作由独立的授权执行组件处理，Web 不应以 root 运行。
6. **默认安全**：v0.1 仅允许只读操作，后端只绑定 `127.0.0.1`。

## MacBook 本地开发

准备：Node.js **22.12+** 或 24，以及 npm。

在项目目录执行：

```bash
npm install
npm test
npm run dev:api
```

再打开第二个终端，在同一目录执行：

```bash
npm run dev:web
```

浏览器打开 Vite 显示的地址，通常是 `http://127.0.0.1:5173`。

内置演示模块：

- `system.info`：通过 Node.js 的 `os` 模块读取**当前主机**信息；在 MacBook 上运行时显示 Mac 信息，不是 VPS 信息。
- `services.list`：在 Linux 上只读查询 systemd 服务；在 MacBook 上返回标注为 `mock-macos` 的模拟数据。

## 文件结构

```text
apps/api/           Fastify Web API 和静态文件服务
apps/web/           Vue 3 + Vite 前端
core/               ModuleManager、ActionRegistry、ActionEngine
modules/system/     系统信息模块
modules/services/   服务列表模块
tests/              Node.js 内置测试
 docs/              架构、安全、部署与路线图
 ecosystem.config.cjs   PM2 进程定义
```

## 本地构建

```bash
npm run build:web
npm start
```

构建后，服务仍**只监听** `127.0.0.1:4188`。不要为当前原型配置公网 Nginx 反向代理或公开 MCP；先完成身份认证、权限审批、审计和安全检查。想从 Mac 访问 VPS 上的本地端口，可以在未来部署后使用 SSH 隧道。

详见：[架构设计](docs/architecture.md) · [安全边界](docs/security.md) · [PM2 部署](docs/deployment.md) · [路线图](docs/roadmap.md)。

## 当前实现范围

- [x] 可信内置模块扫描、依赖顺序加载
- [x] 模块向共享 Action Registry 注册操作
- [x] Web API 列出、预览、执行只读 Action
- [x] Vue 前端展示操作、底层说明及原始输出
- [x] MCP 暴露元数据预留（**尚未实现 MCP 服务**）
- [ ] 登录认证、权限、CSRF 防护
- [ ] 有审批绑定的操作计划和持久审计
- [ ] 特权执行组件、文件管理、交互式终端
- [ ] 远程 OAuth MCP 适配器
- [ ] Nginx、PHP、数据库和备份模块

这个原型不会修改现有宝塔、Nginx、数据库或系统服务。
