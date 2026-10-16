# MCP 与 OAuth（当前行为）

更新：2026-10-16。MCP 可选、默认关闭。扩展依赖：`npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock`。自管 HTTPS 代理提供 /mcp，默认面板只监听 127.0.0.1:4188。

## 可信个人客户端

Web 设置开启 MCP、按需开启客户端注册；OAuth Authorization Code + PKCE S256，管理员登录批准整个连接。有效 grant 可使用全部 exposure.mcp 的 read Action 和明确批准的 terminal.execute 普通用户 Shell；更新申请/直接执行另有全局策略。不逐客户端/逐工具分配 Scope 或白名单。撤销整个 grant、关闭 MCP 或相应更新策略立即生效；新全局暴露 Action 对已有有效客户端可见。

资源受众绑定、Bearer/refresh、offline_access、注册与撤销由适配器处理。旧 Scope 可存在于历史授权/发现元数据中，不代表当前逐工具访问控制；新授权页面以当前全局能力为准，不应请求已退役模块的 Scope。

## 当前业务工具

| Action / 工具 ID | result |
| --- | --- |
| system.info | 主机基本字段 |
| system.resources | cpu、memory、disk 对象 |
| services.list | systemd 服务列表 |
| terminal.execute | 普通服务账户执行 command，返回 stdout/stderr/exitCode 等 |

旧 system.cpu/system.memory/storage.usage 不再注册，无隐藏别名。升级后刷新 tools/list；ChatGPT 工具名可能把点变为下划线。Web/MCP 共用命令配置、执行、解析和 schema 校验。MCP 当前只返回 result；引擎 raw 原文由 Web 原始数据表格/JSON 展示，不自动加入现有 MCP 公开返回。

平台还可能提供 panel.update.status。panel.update.request 只创建申请，需 Web 密码/可选 TOTP 确认；panel.update.execute 需全局直接执行策略和已激活 Broker，可直接排队可信 origin/main SHA，无需重复 Web 审批。实际清单以 live tools/list 为准。

## 工具清单与客户端缓存

模块在进程启动时加载。安装、删除或修改 Action 后，需要通过正常更新/重启让注册表生效；下一次 tools/list 会按当前注册表与全局策略生成清单。已有有效 OAuth grant 不需要因为新增工具重新授权，退役工具也不会保留可调用别名。

当前适配器使用按请求创建的 MCP server，没有跨请求主动广播 notifications/tools/list_changed；不能保证客户端自动发现更新。客户端缓存的工具名与服务器实时清单是两回事。升级后在客户端刷新工具清单；客户端没有刷新入口时，重新连接并再次发现工具。仅刷新面板网页不等于刷新 MCP 工具缓存，也不应通过重新部署或放宽权限来处理旧清单。

回归测试 tests/mcp-inputs.test.js 模拟模块升级及服务重启，复用原 Bearer/grant，验证新工具及必填参数、旧工具消失/不可调用、旧授权撤销继续生效。它证明服务端协议行为，不代表某个第三方客户端已刷新缓存。

## 更新和排错

用完整 SHA 调用直接更新；queued 只代表入队，之后检查 lastResult.status/sha、pending 和服务健康。重启窗口可短暂返回 Internal error，恢复后重查，不重复排队。授权测试 VPS 使用最少必要检查，不默认要求快照/额外哈希流程。

连接失败先查扩展依赖、全局开关、HTTPS origin、/mcp 代理和授权撤销；工具不可见查注册 exposure、global policy 和实际 tools/list，不以旧 per-tool Scope 文档修复。

Token/Cookie/客户端 ID/私有主机数据和输出不入公开仓库或工件。模块不获得 sudo/root；自定义普通用户 Shell 不是只读沙箱，业务写类型仍默认拒绝。

[架构](architecture.md) · [模块规范](MODULE-DEVELOPMENT.md) · [更新器](UPDATER.md) · [状态](PROJECT-STATUS.md)

## Action 参数

普通工具现通过 SDK fromJsonSchema 使用 Action.inputSchema/outputSchema，工具调用转发实际参数到同一 ActionEngine；原空参数限制已修复。terminal.execute 示例与权限见 [TERMINAL.md](TERMINAL.md)，仅普通服务身份，无 root/sudo、无逐命令审批。未实现执行策略的其他 write 仍不暴露。
