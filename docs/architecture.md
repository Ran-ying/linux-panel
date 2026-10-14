# Linux Panel 架构设计 v0.1

## 设计原则：Module-owned Actions, Shared Execution

每个可信内置模块拥有自己的 `manifest.json`、`index.js` 和 `actions/`；Core 不负责具体业务实现。

```text
系统 / 服务 / Nginx / 文件等模块
              │ 注册操作
              ▼
        ModuleManager
              │
        ActionRegistry ──── Web UI（通过 API 发现）
              └────────── MCP（后续适配器，尚未实现）
              │
        ActionEngine
              │
     Linux Adapter / Privilege Broker（后续）
```

**ModuleManager**：扫描预置模块、读取清单、检查依赖环和缺失依赖、按顺序运行模块的 `setup()`。v0.1 不支持模块热卸载、运行时在线安装；安装任意 Node 模块并不能获得安全隔离。

**ActionRegistry**：存储操作 ID、参数 Schema、说明、风险、入口暴露策略和执行函数；对 Web/MCP 只发布元数据，不泄露 JS 函数实现。

**ActionEngine**：验证 JSON 参数和入口授权。v0.1 拒绝全部 `kind: write` 操作；只读预览用来解释行为，并非带审批绑定的不可变计划。

**Web/MCP**：两种入口应共享 Registry 和 Engine，但每个入口仅能看到**当前用户被授权的操作子集**。最终执行阶段还要重新检查权限，不能信任客户端声称的身份或入口类型。目前只实现本地 Web API，没有 MCP 服务。

## 单个 Action 的字段

`id`、`title`、`description`、`inputSchema`、`kind`、`permission`、`exposure`、`explain`、`createPlan()`、`execute()`。

当未来添加修改系统的 Action 时，必须由服务器创建执行计划、检查参数和权限、绑定不可变计划 ID / 哈希、取得必要确认，然后由低权限 Core 或独立特权组件执行**同一个已批准计划**。如果计划发生变化必须重新确认。

## Linux 学习设计

每个操作展示：Linux 原理、计划调用的命令或系统 API、输入参数、执行结果、退出码与错误信息（写入型 Action 完成后还要有变更历史与恢复方案）。例如 `services.list` 使用 `systemctl list-units`；macOS 没有 systemd，使用带显著提示的 mock 而非伪装为真实 VPS 数据。

## 生命周期（后续实现）

`discovered → validated → loaded → active → disabled / failed`

当前已实现可信模块发现和初始化，其他生命周期、在线模块安装与权限审批仍在路线图中。
