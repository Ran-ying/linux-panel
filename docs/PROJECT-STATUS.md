# Linux Panel 当前状态

更新：2026-10-16。[v0.5.0 已发布](https://github.com/Ran-ying/linux-panel/releases/tag/v0.5.0)，main 继续迭代。本文只描述当前实现；旧过程移至 [历史归档](history/PROJECT-STATUS-2026-10-16.md)。最终 CI/部署证据见 [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54)。

## 本次实现

- 真正的 system.info（基本信息 + disk）与 system.resources（cpu + memory）。原 system.cpu/system.memory/storage.usage 和独立 storage 模块删除，无隐藏 Action 别名。
- 命令按 terminal.migrateFrom 声明迁移，当前保存值优先；保存写当前 Action，保留旧私有条目。
- 面板通用 sections 按嵌套 outputSchema 校验。App.vue/导航无系统 Action ID 合并；模块仅提供数据/schema/说明/presentation，无 CSS/Vue。
- 单 Action → 单卡片、单保存、单执行请求、原始 key 列表/JSON。raw 是当次成功终端的 stdout/stderr/exitCode；result 单独解析校验。MCP 当前只返回 result。
- [模块规范](MODULE-DEVELOPMENT.md) 含完整复制示例、职责/展示/命令/权限契约及 AI 交付清单。README/架构/MCP/升级/安全/路线图已同步。

## 保持的能力与边界

管理员/TOTP、默认 30 天可配置会话、后台登录检查、浅色/Auto/深色、居中卡片、固定移动导航/PWA、Web/MCP 共用执行。可信个人 OAuth grant + 全局策略，不逐工具 Scope。Linux 编辑 Shell 以非 root 身份，每条 5 秒/128 KiB，不是只读沙箱。root Broker 只接受固定可信 main 更新任务。

## 验证与部署

本次 CI/合并/部署待验证，不能据此声称已更新主机。基线 main / 最后确认测试部署：46b22836957cb2c2ebf5e4ca285185a22497fa41（PR #97），main CI 38830949668 / scan 38830949674；MCP 事务 9234c315c1027e154a5f09d3676792e0 成功于 2026-10-16T00:43:53Z，服务 active/running。

本地已通过语法检查、Vue 构建和 19 项针对测试；1 项普通 Linux 执行测试因当前 UID 0 跳过。CI 将补充真实执行与全量验收。

需验证：旧配置迁移优先级、仅两个系统 Action、嵌套展示校验、真实默认命令、Web/MCP 清单、手机/桌面保存和 raw。随后按精确 SHA 部署并确认持久化结果/服务，最终记录 Issue #54。

## 下一步

真实 iPhone/Android QA、更多诊断模块、通用复杂输入表单。业务写操作需独立策略。未实现不可信插件沙箱、多管理员/分布式状态，未做独立安全审计。历史 v0.5 计划的待办不代表当前仍未发布。

[模块规范](MODULE-DEVELOPMENT.md) · [架构](architecture.md) · [升级](UPGRADING.md) · [MCP](mcp.md) · [路线图](roadmap.md)
