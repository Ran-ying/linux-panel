# Linux Panel 路线图

更新：2026-10-16。[v0.5.0 已发布](https://github.com/Ran-ying/linux-panel/releases/tag/v0.5.0)，旧 tag 固定；main 以独立 PR 迭代。[当前状态](PROJECT-STATUS.md) 描述当前功能，[Issue #54](https://github.com/Ran-ying/linux-panel/issues/54) 提供部署证据。

## 已完成

ActionEngine/可信模块/schema；Web/MCP 共享执行；管理员/TOTP/可配置 30 天会话；可信个人 MCP 全局策略；受限 main SHA 更新/Broker/回滚恢复；响应式 PWA/固定移动导航/浅色 Auto 深色；可编辑普通用户命令与原始输出；真正合并的系统 Action、通用 sections renderer、面板优先模块规范。

## 后续

1. 按真实使用反馈做手机设备 QA，浏览器截图不替代 iPhone/Android。
2. 按 MODULE-DEVELOPMENT.md 扩展诊断模块，复用 presentation、权限与命令能力。
3. 通用复杂输入表单/新 renderer 先定义校验协议与测试，避免业务 ID 特判。
4. 服务日志/受限重启等业务写操作需单独策略，不引入通用 root Shell。
5. 持续改进安装、升级、恢复并记录实际支持平台。

独立安全审计、多管理员、第三方模块隔离和分布式状态尚未实现。旧 [v0.5 计划](V0.5-RELEASE-PLAN.md) 是历史验收记录，不表示当前仍未发布。
