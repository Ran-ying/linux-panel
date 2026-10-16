# Linux Panel 当前状态

更新：2026-10-16。[v0.5.0 已发布](https://github.com/Ran-ying/linux-panel/releases/tag/v0.5.0)，main 继续迭代。本文只描述当前实现；旧过程移至 [历史归档](history/PROJECT-STATUS-2026-10-16.md)。最终 CI/部署证据见 [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54)。

## 本次实现

- 服务浏览 services.list 支持可选名称关键词/运行状态/子状态组合筛选，逻辑位于 Action；状态选项取完整采集，raw 保持原始完整输出。面板新增通用 text/select 输入和经过校验的输出选项引用，模块只提供声明。
- 基本信息的 Action、命令和 Schema 已移除主机名、内存、cpuCount；新增发行版及版本，内核版本单独展示。并行度迁入 resources.cpu.availableParallelism，沿用旧自定义命令。CPU 不再显示折算小数核数，改为百分比及整数计数。
- 手机导航外框/选项卡直角且左右贴边、无左右边框，缩小选项卡内边距与展开/收起按钮高度；上下安全边距和滚动/覆盖行为保留。
- 真正的 system.resources（cpu + memory + disk，排在最前）与 system.info（基本信息）。原 system.cpu/system.memory/storage.usage 和独立 storage 模块删除，无隐藏 Action 别名。
- 磁盘采集、命令、raw、Schema 实际迁入 resources；filesystem 配置优先当前 resources，其次旧 info、旧 storage。命令按 terminal.migrateFrom 声明迁移，支持有序候选，当前保存值优先；保存写当前 Action，保留旧私有条目。
- 面板通用 sections 按嵌套 outputSchema 校验；新增 grid 布局和 gauge 圆环卡片（名称、占用圆环/百分比、数量或字段详情），复用基本信息的圆角样式。App.vue/导航无系统 Action ID 合并；模块仅提供数据/schema/说明/presentation，无 CSS/Vue。
- Action 标题右侧放置说明/命令胶囊，移除读取类型标签与独立“信息”标题；默认只展示操作结果，点击后展开相应说明或命令，再次点击收起。
- 单 Action → 单卡片、单保存、单执行请求、原始 key 列表/JSON。raw 是当次成功终端的 stdout/stderr/exitCode；result 单独解析校验。MCP 当前只返回 result。
- [模块规范](MODULE-DEVELOPMENT.md) 含完整复制示例、职责/展示/命令/权限契约及 AI 交付清单。README/架构/MCP/升级/安全/路线图已同步。

终端/参数映射变更的完整 CI、浏览器/PTY 与部署证据统一见对应 PR / Issue #54；不能把上面的旧基线测试当作新变更验证。

## 保持的能力与边界

管理员/TOTP、默认 30 天可配置会话、后台登录检查、浅色/Auto/深色、居中卡片、固定移动导航/PWA、Web/MCP 共用执行。可信个人 OAuth grant + 全局策略，不逐工具 Scope。Linux 编辑 Shell 以非 root 身份，每条 5 秒/128 KiB，不是只读沙箱。root Broker 只接受固定可信 main 更新任务。

## 验证与部署

系统 Action 合并的基线记录：PR #98，基线 main 为 46b22836957cb2c2ebf5e4ca285185a22497fa41。语法检查、Vue 构建、19 项本地针对测试通过（1 项普通 Linux 用例在 UID 0 环境跳过）；完整 CI 38833349238 和历史扫描 38833349253 已通过，包含普通 Linux 命令、OAuth/MCP、配置迁移与多宽度浏览器/PWA 验收。

部署结果只在 [Issue #54 最新记录](https://github.com/Ran-ying/linux-panel/issues/54) 维护一份，运行中的准确 SHA 由 MCP panel.update.status 返回。本页不反复缓存会过时的“当前服务器版本”，也不以 PR 合并或 queued 推断部署成功。每次部署必须核对持久化 SHA/status 和服务健康，再更新交接记录。

## 终端与参数协议

新增终端模块，只有 terminal.execute 一个 Action，接收 command / 可选 timeoutSeconds，返回 stdout/stderr/退出码/超时/截断/耗时。它是明确批准的普通服务账户 Shell 写能力，不使用 root Broker。

面板提供通用 textarea 输入、terminal 结果 renderer 及卡片下方的黑色真实 PTY，支持目录保持、Ctrl+C、交互输入和尺寸变化。PTY 需要 Python 3，复用 Web 会话/Origin/CSRF，最多两个内存会话，撤销/闲置/退出清理，命令与输出不持久化。

MCP 现直接公布 Action 输入/输出 Schema、转发参数，由同一引擎验证，原空参数不足已补齐。普通 read 和这一批准的 user-shell 能力随模块暴露给已授权可信客户端，其他 write 默认拒绝。详情见 [终端规范](TERMINAL.md)。

## MCP 清单验证边界

补充升级回归：模块更新/服务重启后，旧有效 OAuth token 重新 tools/list 可发现新 Action，退役 Action 不可调用，参数校验与整连接撤销仍生效。服务端按请求生成清单，当前没有跨请求推送工具变化；第三方客户端可能缓存旧清单，需要客户端重新发现。当前会话尚未获得 terminal.execute 工具，不能把 CI 通过写成部署后实际 MCP 终端调用成功。具体证据见 Issue #54；客户端处理见 [MCP 排错](mcp.md#工具清单与客户端缓存)。

## 下一步

真实 iPhone/Android QA、更多诊断模块、通用复杂输入表单。业务写操作需独立策略。未实现不可信插件沙箱、多管理员/分布式状态，未做独立安全审计。历史 v0.5 计划的待办不代表当前仍未发布。

[模块规范](MODULE-DEVELOPMENT.md) · [架构](architecture.md) · [升级](UPGRADING.md) · [MCP](mcp.md) · [路线图](roadmap.md)
