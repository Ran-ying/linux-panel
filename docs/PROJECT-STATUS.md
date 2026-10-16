# Linux Panel 当前状态

更新：2026-10-16。[v0.5.0 已发布](https://github.com/Ran-ying/linux-panel/releases/tag/v0.5.0)，main 持续迭代。本轮基于 main 9507e0c6f933df464f52537f69c03868080bd30d（PR #107）；准确合并 SHA、CI 和部署证据统一见 [Issue #54 最新记录](https://github.com/Ran-ying/linux-panel/issues/54)。旧过程见 [历史归档](history/PROJECT-STATUS-2026-10-16.md)。

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

上一轮 PR #107 已修复严格 umask 下的文件权限测试假设；CI、浏览器和测试服务器成功证据见 Issue #54。该轮观察到的服务器 SHA 为上述 9507e0c，不能当作本轮新功能已部署的证据。本轮增加顺序追加回归、目录统计/链接/文件变更/API 授权测试，以及手机/桌面新建、重命名、删除和拖入上传浏览器流程。实际 CI、合并和 MCP 部署完成后须在 Issue #54 记录；queued 不等于成功。

下一步：真实 iPhone/Android QA、更多诊断模块和通用复杂输入表单。文件大目录完整统计与目录上传尚未实现，当前界面明确区分部分大小。

[模块规范](MODULE-DEVELOPMENT.md) · [架构](architecture.md) · [升级](UPGRADING.md) · [MCP](mcp.md) · [路线图](roadmap.md)
