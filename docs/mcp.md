# MCP 可选扩展开发说明

## v0.4.1 现状

`extensions/mcp` 不是业务 Action 模块。独立扩展只负责 MCP 协议与 Web 子页面；CPU、内存、磁盘、systemd 业务 Action 依旧在 `modules/`，统一通过 `ActionEngine` 调用。

- 初始 `mcp.policy.enabled=false`，没有业务 Action 可匿名访问。
- Web 设置页 `MCP 扩展 · 工具权限` 可开启/关闭 MCP 端点，并逐个允许 read-only MCP Action。
- 默认每个工具都关闭。即使一个后续业务模块新增 Action，也**不会自动进入 MCP 白名单**。
- 目前尚未实现 OAuth 授权服务：即使 Web 中开启 MCP，`/mcp` 对所有请求仍返回 401。此行为是刻意的 fail-closed，不是客户端故障。
- 只有用户权限、OAuth Scope、运行时工具白名单三者同时满足时才能执行 Action。v0.4.2-0.4.3 会补上剩余两层授权。
- 不允许通过 Web Cookie 调用 `/mcp`。
- MCP 扩展独立 npm 依赖在 `extensions/mcp/package.json`；激活远程传输前应执行 `npm install --prefix extensions/mcp --omit=dev`。SDK 按需加载，v0.3 的标准 `npm ci` 不应因为未安装扩展依赖而阻止 Web 正常启动。

## 提醒

安装 SDK 或看到 401 不意味着 ChatGPT 已能完成连接；真正连通必须等标准 OAuth 服务及授权界面上线后，再由 ChatGPT 做端到端测试。
