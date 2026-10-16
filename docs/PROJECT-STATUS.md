# Linux Panel 当前状态

更新：2026-10-16。[v0.5.0 已发布](https://github.com/Ran-ying/linux-panel/releases/tag/v0.5.0)，main 持续迭代。本轮基于 main a9fb7c20fb386dcb9833f1b684ff50abf17c80cf（PR #109）；准确合并 SHA、CI 和部署证据统一见 [Issue #54 最新记录](https://github.com/Ran-ying/linux-panel/issues/54)。旧过程见 [历史归档](history/PROJECT-STATUS-2026-10-16.md)。

## 当前实现

- 模块顺序持久化；首次初始化为系统概览、服务浏览、终端、文件管理。新模块追加末尾，依赖装载与导航显示顺序独立。
- [文件管理](FILES.md)：目录分页、MB 大小、目录递归逻辑大小（部分统计明确标识）、权限/所有者、UTF-8 编辑、选择/拖入上传、新建、重命名和删除。七个 Action 使用普通服务账户；五个写 Action 仅 Web。面板提供 GUI，模块只提供数据、Schema 与展示声明。
- 系统概览含真正的 system.resources（CPU/内存/磁盘）与 system.info（发行版及版本、内核、架构、运行时间、Node 版本）。资源排最前，圆环卡片显示占比与用量，CPU 显示整数逻辑处理器/可用并行度。旧拆分 Actions 已删除，旧命令配置按声明迁移。
- 基本信息不自动刷新；服务浏览的名称、运行状态、子状态条件在 Web 即时筛选已加载结果，刷新按钮重新采集。API 仍支持组合筛选。
- Action 标题旁说明/命令胶囊默认折叠，单 Action 对应单卡片、单执行；raw 保留实际命令 stdout/stderr/exitCode，result 单独解析。通用 metrics/progress/gauge/table/sections/terminal/files 渲染器与输入控件由面板维护，无 App.vue 业务 ID 特判。
- 终端只有 terminal.execute 一个 Action，支持 Web/MCP 参数与结果；Web 黑色真实 PTY 支持交互、目录保持和 Ctrl+C，普通服务账户执行。MCP 从注册 Action 的 Schema 生成工具与参数，现有有效可信 grant 可重新获取新清单。无需为本轮文件功能另做实际 MCP 发现测试。

## 保持的边界

单管理员/单进程；管理员/TOTP、默认 30 天可配置会话、后台登录检查、浅色/Auto/深色、居中卡片、固定移动导航/PWA。Web/MCP 共用引擎；个人 OAuth 整客户端授权，工具还受全局策略与显式 exposure 控制，不逐工具分 Scope。可编辑 Shell 与文件操作拒绝 root，不是路径沙箱；root Broker 仅执行固定可信 main 更新。无不可信插件沙箱、多管理员或独立安全审计。

## 验证与部署

PR #109 已通过完整 CI 并部署到测试服务器，观察到的 SHA 为 a9fb7c20fb386dcb9833f1b684ff50abf17c80cf。本轮按需求简化文件浏览（chrome:minimal、两排同高导航/操作、日期时间分行、MB 两位小数），新增 writeAccess 与不可写目录提示/控件状态。已核实默认服务的 ProtectSystem/ProtectHome 与普通账户权限是系统目录只读、/root 不可访问的原因；本轮调整 UI 与提示，不扩大主机权限。新增布局、格式和不可写目录浏览器回归，最终 CI 和部署记录见 Issue #54。

下一步：真实 iPhone/Android QA、更多诊断模块和通用复杂输入表单。文件大目录完整统计与目录上传尚未实现，当前界面明确区分部分大小。

[模块规范](MODULE-DEVELOPMENT.md) · [架构](architecture.md) · [升级](UPGRADING.md) · [MCP](mcp.md) · [路线图](roadmap.md)
