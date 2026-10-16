# Linux Panel 当前架构

更新：2026-10-16。[v0.5.0 已发布](https://github.com/Ran-ying/linux-panel/releases/tag/v0.5.0)；main 后续行为以 [当前状态](PROJECT-STATUS.md) / Issue #54 为准。

模块 setup → ActionRegistry → ActionEngine（输入/执行/输出校验）→ Web/MCP 授权适配器。模块只定义业务；认证、命令配置、执行限制和 GUI 由面板提供。

- platform：管理员、会话/TOTP、CSRF/Origin、私有状态、MCP 全局策略、可编辑命令、更新/监听配置。
- core：可信随仓库模块发现与依赖、注册、JSON Schema、默认拒绝新写类型。
- modules/system：system.resources（cpu + memory + disk，优先展示）、system.info（主机基本字段）。collectors 为内部帮助代码，旧 split Actions 与 storage 模块已移除。
- modules/services：services.list。
- modules/terminal：terminal.execute（显式 user-shell 写能力），命令输入和 PTY GUI 均由面板提供。
- apps/api：Fastify、业务 API、数据型 presentation 校验。配置不能携带样式/脚本。
- apps/web：布局、主题、固定导航、卡片、命令编辑保存、刷新、raw 表格/JSON、通用 metrics/progress/gauge/table/sections/terminal、声明式 textarea 输入与真实 PTY。没有系统 Action ID 特判和跨模块卡片拼装。
- extensions/mcp：独立可选 Streamable HTTP/OAuth，无 Vue 依赖；调用同一引擎，当前工具只返回 result，Web 还能展示 raw。
- root Broker：独立安装，可信 main SHA、非 root 构建、固定 systemd 部署/健康检查/回滚，不能接受任意模块命令。

## 执行与展示

一个 Action 对应一个卡片、一个保存入口、一次刷新请求和原始 key 列表。组合结果在 outputSchema 定义子对象，由 sections.key 选取展示；协议及复制示例见 [模块规范](MODULE-DEVELOPMENT.md)。

Linux terminal.fields/decode 定义命令/解析，管理员通过统一 CSRF/Origin 保护的 Web 表单配置。非 root 服务身份执行，每条 5 秒/128 KiB；引擎保留 raw 原文，用修剪副本解析并验证 result。自定义普通用户 Shell 不是只读沙箱，不获得 sudo/root。迁移配置使用模块声明的 migrateFrom。

## 当前授权

Web 使用管理员 Cookie、权限/Origin/CSRF，敏感变更另验密码/可选 TOTP。MCP 默认关闭；OAuth PKCE 授予整个可信客户端访问，全局控制 read 暴露、更新申请和直接更新，不按客户端/工具分配业务 Scope；旧 Scope 仅兼容保留。撤销整个 grant 即刻失效。

写 Action 默认拒绝；现有 proposal-only、精确 broker-enqueue 和 terminal.execute 的 user-shell 策略要求可信适配器上下文。MCP 直接更新需独立全局策略与 Broker 激活，之后不要求每次 Web 审批。

## 范围

单管理员、单 Node 进程、单机 JSON；没有分布式一致性、多管理员、第三方不可信插件沙箱或任意特权 Shell。TOTP、受限更新 Broker 和真实 MCP 部署已实现；测试不等于独立安全审计。真实手机/广泛发行版覆盖以具体验收为准。

[安装](INSTALL.md) · [MCP](mcp.md) · [升级](UPGRADING.md) · [安全](security.md)
