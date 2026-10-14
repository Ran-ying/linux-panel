# Linux Panel

一个以**可理解、可检查、可扩展**为目标的 Linux 管理面板。基于 JavaScript ES Modules、Fastify、Vue 3，采用模块拥有 Action、Web/MCP 共享操作定义的架构。

> **当前阶段：v0.2 开发分支，本地只读原型。没有认证和真实 MCP 服务，严禁直接暴露公网。**

## v0.2 功能

- ModuleManager 读取可信内置模块的 Manifest、检查依赖并调用 setup()。
- ActionRegistry 统一注册 Action，向 Web 公开 Input/Output Schema 与 Presentation 元数据。
- ActionEngine 用 AJV 验证输入和执行结果；仍然拒绝所有声明为 write 的操作。
- Web UI 根据 `presentation.type` 自动呈现 **metrics / progress / table**；可以切换原始 JSON 并查看操作计划。
- `system.info`：系统概况。
- `system.memory`：Linux 读 /proc/meminfo 的 MemAvailable；Mac 则显示估算值提示。
- `system.cpu`：两次 CPU 时间计数器采样，估算整体 CPU 使用率。
- `storage.usage`：使用 fs.statfs() 获取根文件系统容量（无需 Shell）。
- `services.list`：Linux 使用 systemctl 并解析结构化服务记录；macOS 返回明确标记的模拟数据。

本项目运行在 MacBook 上时，**读取的是 MacBook，不是远端 VPS**。所有图表均来自实际 Action 结构化结果，没有写死示例数值。

## 本地开发

需要 Node.js 22.12+ 或 24，npm。

```bash
cd ~/Projects/linux-panel
npm ci
npm test
npm run check
npm run build:web
```

打开两个终端，分别运行：

```bash
npm run dev:api
# 第二个终端
npm run dev:web
```

浏览器访问 <http://127.0.0.1:5173>。

生产模式的 Web 静态资源可由 Fastify 一起提供；部署时只需一个 Node.js 后端进程，但当前版本不适合公网使用。详见 [docs/deployment.md](docs/deployment.md)。

## 架构

```text
modules/{system,storage,services}/actions/*
       │ action + outputSchema + presentation
       ▼
ModuleManager → ActionRegistry → ActionEngine
                       │              │
                 API 元数据         运行结构化结果
                       └───── Web Renderer
                                ├─ metrics
                                ├─ progress
                                ├─ table
                                └─ raw JSON
```

Web 和未来的 MCP 都使用同一 Action Registry/Engine。现在尚未实现 MCP transport、用户认证或独立权限验证；`exposure.mcp` 只是元数据。

操作预览用于理解数据采集方法，**不是与实际执行绑定的审批计划**。下一阶段实现 Auth/Permissions、审计与高权限隔离。

## 约束

不要把 .env、Token、密码、数据库备份或私人文件推送到 GitHub。所有 Action 只操作当前进程所在主机；不要用 root 运行面板。开发 API 绑定 127.0.0.1，禁止配置公网反向代理。

[架构](docs/architecture.md) · [部署](docs/deployment.md) · [安全](docs/security.md) · [路线图](docs/roadmap.md)
