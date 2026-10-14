# 开发路线图

1. **v0.1**：MacBook 本地只读原型、ModuleManager、ActionRegistry、基础 Vue 页面（已提供骨架）。
2. **v0.2**：认证、权限、可审计的 Action Engine、不可变计划和执行审批。
3. **v0.3**：Linux 适配器、隔离的 PTY 终端、文件与 systemd 管理。
4. **v0.4**：受 OAuth 保护的 MCP 适配器，读取同一 Registry、调用同一 Engine。
5. **v0.5**：Nginx、PHP-FPM、数据库模块，兼容宝塔历史部署方式。
6. **v1.0**：网站、备份与恢复、网络安全与运维知识文档。

每个模块都应完成：需求与架构解释 → Linux 原理与手动验证 → JavaScript 实现 → 单元测试 → 权限审查 → 失败与恢复测试。正式接管宝塔管理的文件前必须有可靠备份。
