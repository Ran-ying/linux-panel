# Linux Panel v0.4 架构

## 核心边界

```text
modules/{system,storage,services}/actions    真正的只读系统能力
                 |
          ActionRegistry
                 |
          ActionEngine / JSON Schema
          /                        \
Web API + Vue 3                   MCP Streamable HTTP
  Web Cookie/CSRF                  OAuth Bearer / PKCE
  独立 UI presentations            Scope + MCP allowlist
       |                                 |
  GET/POST /api/*                     /mcp
```

- **平台层**：`platform/auth` 管理管理员、会话及权限；`platform/state-store.js` 负责单进程 JSON 原子持久化。
- **Core**：注册 Action（名称、输入/输出 Schema、授权元数据），验证及执行。UI 配置不能获得额外执行权限。
- **模块**：放在 `modules/*`，一个模块拥有自己的 Actions 及可选 UI presentations。
- **Web**：`apps/api` Fastify、`apps/web` Vue 3。Web 负责布局、进度条/表格/指标及刷新策略。
- **MCP**：`extensions/mcp` 是独立可选传输适配器，复用业务 Action，**不依赖 Vue**。默认关闭，所有新工具默认不可见。
- **平台更新 Action**：`platform/update-actions.js` 注册 `panel.update.status`（只读）和 `panel.update.request`（创建申请）；`platform/update-controller.js` 持有共享更新逻辑，Web API 和 MCP 都通过 Action Engine 执行。更新批准仍属于特殊高保障的 Web 认证流程，不是可由 MCP 自动批准的 Action。
- **OAuth**：内置 Auth 登录确认、PKCE S256、Bearer Token、资源受众绑定、客户端单独 Scope 授权与即时撤销。实际执行需要 用户权限 ∩ Token Scope ∩ Action 白名单。

## 写入 Action 的安全边界

Action Engine 对任意 `kind:write` 仍默认拒绝。当前唯一允许的类型是 `executionPolicy:proposal-only`，且必须由已认证的 Web 或 OAuth MCP 适配器携带可信执行上下文，不能直接更改系统。部署步骤由单独的 root-owned Broker 执行，需要管理员在 Web 中二次确认。

## 当前限制

仅限单管理员、单个 Node 进程、单机 JSON 存储，不支持水平扩容；没有任意 Shell、文件系统写入或特权 Broker。多管理员、2FA、第三方扩展隔离需要另行设计。根文件系统是使用 `fs.statfs` 读取，内存使用 `/proc/meminfo`，CPU 采样 `os.cpus`，服务清单读取 systemctl。

部署：[INSTALL.md](INSTALL.md) · OAuth：[mcp.md](mcp.md) · 升级：[UPGRADING.md](UPGRADING.md)。
