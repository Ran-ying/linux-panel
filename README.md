# Linux Panel

Linux Panel 是以**可理解、可检查、可扩展**为目标的 Linux 管理平台。基于 JavaScript ESM + Fastify + Vue 3。业务模块提供 Action；Core 验证、调度并执行；Web UI 决定展示；未来 MCP 扩展调用同一 Action Engine。

> **v0.3 开发里程碑：本地认证与设置版本。没有远程 OAuth/MCP，未经专门安全验收不得通过 Nginx 暴露公网。**

## v0.3 已实现

**内置平台功能，不依赖任何业务模块：**

- Auth：通过**服务器本地 CLI** 创建第一个管理员账号；不开网页注册、没有默认密码。
- 密码使用带随机盐的 scrypt 保存；持久化文件权限要求 0600。
- Web 登录：短期 HttpOnly + SameSite=Strict Cookie 会话（最长 12 小时）、登录失败限流；可主动退出。
- 通过登录会话和 CSRF 请求头保护所有现有 Web Action API，服务端执行权限检查。
- 内置面板设置：修改面板名称、修改密码（同时撤销已有会话）、列出和撤销会话、查看简要操作审计及已安装业务模块。
- 所有业务模块不存在时，登录和内置设置仍然可用。

**只读业务模块：** `system.info`、`system.memory`、`system.cpu`、`storage.usage`、`services.list`。仍然保留每个 Action 的结果 Schema 和独立 Web 可视化。

## MacBook 本地启动

需要 Node.js 22.12+ 或 24、npm：

```bash
cd ~/Projects/linux-panel
git pull --ff-only origin main
npm ci
npm test
npm run check
npm run build:web
```

**首次初始化管理员（必须在终端执行，不要通过网页）：**

```bash
npm run admin:init
```

默认用户名 `admin`，也可以使用 `npm run admin:init -- yourName` 指定用户名。密码通过终端隐藏输入和确认，不能作为命令行参数传递。不得把密码放进 shell history、提交记录或聊天消息。

**启动：** 两个终端分别执行：

```bash
npm run dev:api
# 在第二个终端执行
npm run dev:web
```

打开 <http://127.0.0.1:5173> 输入账号密码。开发环境的 `/api` 由 Vite 代理到 `127.0.0.1:4188`。登录后左侧是业务模块，底部固定有「面板设置」。

私有状态保存在 `data/panel-state.json`，已被 Git 忽略。可以使用 `PANEL_DATA_DIR` 指定非仓库路径。不要直接编辑 JSON，也不要运行多个共享此数据目录的面板进程。

## API 安全模型（v0.3）

`GET /api/auth/status` 与 `POST /api/auth/login` 在登录前可访问。其他 `/api/*` 都需要有效 Cookie 会话；写入型 HTTP 请求还需要 CSRF 头。Action 的权限标识由服务端核实，不能依靠隐藏前端按钮来保护 API。可从浏览器登录并管理会话，不需要开放注册。

目前只有通过 CLI 初始化的单一管理员账户，尚无多用户角色管理、OAuth、MCP、2FA、安全恢复工具或完整公网威胁模型。面板设置中的模块列表只能查看，不支持在线安装第三方代码。OAuth/MCP 是后续 v0.4 的**可选扩展**。

## 网络与部署安全

后端始终监听 `127.0.0.1`。如果使用 Nginx 反代，接口就可以被公网调用，回环绑定本身不能提供认证防护。当前阶段只做本地测试和受控安全评审，**不要把 v0.3 当作已完成公网安全认证的版本**。生产模式要求明确配置 `PANEL_PUBLIC_ORIGIN=https://你的域名`，但这项配置本身不代表可以立即上线。

更多：[架构](docs/architecture.md) · [部署](docs/deployment.md) · [安全](docs/security.md) · [路线图](docs/roadmap.md)
