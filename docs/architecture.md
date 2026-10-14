# Linux Panel 架构 v0.2

## 原则

**Module-owned Actions, Shared Execution; Structured Results, Pluggable Renderers.**

模块在 `modules/<id>/actions/` 拥有自己的 Action、执行逻辑、参数 Schema、结果 Schema、展示元数据及 Linux 原理说明。Core 只负责发现、注册、参数验证、结果验证和调度，不硬编码业务行为。

```text
Manifest → ModuleManager ──setup()──> ActionRegistry
                                       │
                                 ActionEngine
                                       │
                         结构化结果 + Output Schema
                                       │
                   ┌───────────────────┴─────────────────┐
               Web Renderer                         MCP Adapter
          metrics/progress/table                  (尚未实现)
```

## Action Contract

字段：`id`、`title`、`description`、`kind`、`permission`、`exposure`、`inputSchema`、`outputSchema`、`presentation`、`explain`、`createPlan()`、`execute()`。

- `outputSchema` 是描述真实 JSON 对象的 JSON Schema。v0.2 中向后兼容，可选；如声明则 Engine 使用 AJV 校验。失败是服务器实现错误，API 不暴露无效原始结果。
- `presentation` **仅是展示建议**，不会影响执行和授权。当前支持三种类型：
  - `{type:"metrics", fields:[{key,label,format?}]}`：多指标卡片。
  - `{type:"progress", title,valueKey,totalKey?,usedKey?,availableKey?,details?}`：百分比进度条及容量说明。
  - `{type:"table",rowsKey,columns:[{key,label,format?}]}`：结构化列表。
- 可视化采用白名单类型，不接受来自 Action 的任意 HTML/JS。
- Web 使用统一 Renderer 展示，并保留“原始 JSON”视图；MCP 将来只获取结构化结果，不传 Vue 组件。
- `createPlan` 对 Node API 应如实解释调用方式，不要伪造系统命令；只读 preview 不代表操作审批。
- “只读”是可信内置代码约定，不是沙箱：恶意模块即使自称 read，也可能写磁盘。

## 数据采集口径

- 磁盘：`fs.promises.statfs('/', {bigint:true})`，总量 blocks×bsize，已用 (blocks-bfree)×bsize，可用 bavail×bsize；不将可用空间错误地当作总量减已用。
- Linux 内存：`/proc/meminfo` 优先 MemAvailable，macOS Node os.freemem 只是保守估算。
- CPU：`os.cpus()` 时间差 250 ms，得到短时平均忙碌比例。
- systemd：解析 `systemctl list-units --type=service --all --no-pager --no-legend --plain`；保留未能解析的行用于排障。macOS 明确标记模拟数据。

## 安全边界与后续

`permission` 目前仅为元数据。没有登录、授权、审计、计划签名、特权 Broker，后端只能监听 127.0.0.1。MCP transport 尚未实现，不能以 `exposure.mcp` 推断远程调用已经可用。下一阶段实现真正的身份、权限和审计。
