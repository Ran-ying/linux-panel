# Linux Panel 架构 v0.2

## 能力边界与展示边界

**Action 提供能力，Core 负责验证和执行，Web 负责展示与调用策略，MCP 适配器只将 Action 暴露为工具。**

```text
modules/system/actions/memory.js     模块的业务能力
  ├─ inputSchema / outputSchema      API 契约
  └─ execute()                       读取真实主机信息
           │
           ▼
ActionRegistry → ActionEngine → {action, result}
                                  │
     ┌────────────────────────────┴──────────────────────┐
     ▼                                                   ▼
Web API: /api/actions/…                             MCP Adapter（未实现）
     │                                                   │
     │                                                   └── 同一份 JSON，无 UI 字段
     ▼
Web UI (Vue)
     ▲
     │ GET /api/web/presentations
     │
modules/system/ui/presentations.js
     ├─ renderer: progress / metrics / table
     ├─ 字段映射、标签和格式
     └─ refreshIntervalMs（Web 可选策略；不是服务器计划任务）
```

模块仍独立：`modules/<id>/actions/` 定义真实行为；`modules/<id>/ui/` 只声明 Web 需要的静态展示元数据。内置可信模块从 manifest 加载，Web Adapter 读取其 UI 描述文件并验证仅引用**同一模块里对 Web 可见**的 Action 及已声明的 outputSchema 字段。

## 数据契约

- Action 的 `outputSchema` 是 JSON Schema。ActionEngine 使用 AJV 验证结果，不向外暴露不符合 Schema 的数据。
- ActionRegistry 的 `list('web')` 和 `list('mcp')` 只包含能力元数据，不含 UI 展示策略。
- Web-only 接口 `GET /api/web/presentations` 返回 `{ presentations: [{actionId, renderer, ..., refreshIntervalMs}] }`；它不修改 Registry，也不创建任何系统操作。
- 支持 `metrics`、`progress`、`table`；无配置时可退化为 JSON。所有渲染都是可信 Web 代码，UI 文件不允许提交任意 HTML/JS 字符串让客户端执行。
- Web 默认手动读取；若页面提供自动刷新选项，用户勾选后按模块 UI 配置轮询，仅在可见页面执行，避免并发请求；切换 Action 或卸载页面时停止。后端永远不自行定时执行 Action。
- 操作计划仅解释只读采集方式；不是具备服务器审批绑定的操作计划。
- `kind:read` 和 `permission` 目前仅是可信模块约定，**不代表实际隔离或授权**。Web UI 不能提高权限。

## 数据来源

- `storage.usage`：使用 `fs.promises.statfs('/', {bigint:true})` 计算根文件系统容量。区别 `bfree` 和 `bavail`。
- `system.memory`：Linux 读 `/proc/meminfo` 的 `MemAvailable`；macOS 的 `os.freemem()` 是估算。
- `system.cpu`：`os.cpus()` 两次累计计数器之差，获得短时使用率。
- `services.list`：Linux 运行 `systemctl list-units` 解析数据，保留未识别行；Mac 显示 mock。

## 安全边界与后续

v0.2 无登录、独立服务端权限系统、审计、特权 Broker、MCP transport。后端只监听 `127.0.0.1`，禁止公网发布；今后暴露远程访问前必须完成鉴权。MCP 只通过适配器复用 Action 的业务契约，不应该依赖 Vue UI 配置。
