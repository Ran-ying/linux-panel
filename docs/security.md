# Linux Panel 当前安全边界（2026-10-16）

这是一个实验阶段的自托管服务器管理项目，**代码/CI/本地 OAuth 集成测试不等于独立渗透测试或生产安全认证**。

## 已有防护

- 管理员由服务器 CLI 交互初始化，无默认密码、无 Web 自助注册。使用 scrypt 密码哈希；v0.5 支持可选 TOTP 双因素认证、一次性恢复码和按账号/IP 组合的登录限流。
- Web 会话使用随机令牌和 HttpOnly / SameSite Cookie，生产 HTTPS 使用 Secure。私有状态文件模式 0600。
- 生产验证 Host、来源 Origin、CSRF；只信任回环来源的 Nginx 代理头。
- API 绑定 `127.0.0.1`，对公网只开放 Nginx HTTPS；设置 CSP、HSTS 和其他响应头。
- MCP 默认关闭。已登录客户端共享明确声明暴露的只读 Action 和全局允许的更新 Action；不再逐客户端、逐 Action 配置 Scope。新客户端注册、更新申请和直接更新由全局策略分别控制。
- OAuth Authorization Code + PKCE S256，Token 绑定 MCP 资源；每次调用重查有效授权和全局策略。撤销整个客户端授权或修改密码使旧授权失效；新增全局允许的 Action 会对已有有效连接开放。
- MCP 默认提供只读系统信息。可选 `panel.update.request` 仅创建准确 SHA 的更新申请，由 Web 管理员密码及可选 TOTP 确认；全局开启的 `panel.update.execute` 可由有效可信客户端直接提交，无需每次 Web 审批。两者均须单独安装并启用受限 Broker；只接受受信任 origin/main 的准确 SHA，以固定 root 脚本和非 root 构建账号完成，不开放任意 SSH Shell。
- 更新 Broker 独占 root 所有目录保存锁和备份，更新状态文件只对 Web 服务账号可读；Git/npm 由独立 updater 用户执行，避免以 root 运行不可信依赖构建代码。
- 登录及 OAuth 注册有应用层速率限制；公网还需要独立 Nginx 限流。

## 生产部署必要条件

受支持、定期补丁的 Linux；系统级 Node.js 24；非 root 服务用户；独立 `0700` 私有目录；单个 systemd 实例；有效 TLS 和正确 HTTPS 代理；对真实客户端 IP 限流。如果使用 Cloudflare，必须在受信任代理列表内恢复真实客户端 IP，不可信任任意 `X-Forwarded-For`。

## 尚未实现

- 多用户 RBAC、WebAuthn/通行密钥、SSO、设备风险认证和独立第三方安全审计（TOTP 已实现，但不具备抗钓鱼特性）。
- 分布式 Token 存储、跨进程一致性和零停机数据迁移。
- 业务服务启停的特权 Broker、任意 root Shell 和通用业务写权限（受限面板更新 Broker 已存在）。
- OAuth Client ID Metadata Documents（CIMD）等全部可选客户端发现方式。
- 跨各种操作系统、Nginx/CDN 组合的独立生产验收。

已有 ChatGPT MCP 实际只读调用成功，但这不是所有客户端的兼容性或安全保证。

私有状态、Token、配置和凭据不应该出现在 Git、构建日志、公开 Issue 或网页静态目录。公开仓库前请阅读 [PUBLIC-RELEASE.md](PUBLIC-RELEASE.md)。

## v0.5 新增威胁模型

见 [THREAT-MODEL.md](THREAT-MODEL.md) 和 [UPDATER.md](UPDATER.md)。受控测试机已有 Broker 部署与 MCP 更新成功记录，见当前状态/Issue #54；CI 和测试机运行不等于独立生产安全认证。

## Web 登录有效期

默认有效期为 30 天（固定天数，不按自然月）。在“面板设置 → 登录会话”可设置 1–365 天。保存后当前设备从保存时刻重新计时，后续登录使用新值；其他设备既有会话不变。会话服务端到期时间与 HttpOnly/SameSite/Secure Cookie 的剩余有效期同步；普通刷新不会无限续期。

升级前仍有效的旧 12 小时会话，在下次加载会话信息时按原创建时间与配置天数升级一次，并更新 Cookie。已过期、撤销或因密码变更失效的会话不会恢复。策略存储在私有状态中；更新经过登录、管理员权限、Origin 和 CSRF 校验并记录审计。

## 可编辑的终端读取命令

管理员可以在 Action 的“信息 → 命令”中修改命令 value。key 由模块定义，保持输出契约稳定。保存只更新私有状态，后续 Web 刷新和已授权 MCP 读取使用相同配置；修改命令本身不执行命令。该配置入口只提供给已登录 Web 管理员，检查 Origin、CSRF、Action 暴露及权限，审计只记录 Action ID，不记录命令文本。

Linux 的 system.info（基本信息）、system.resources（含 CPU/内存/磁盘）、services.list 默认使用终端命令，通过 `/bin/sh -c` 执行；每个命令限制 5 秒、输出 128 KiB，超时由 coreutils timeout 终止。执行拒绝 UID 0，不使用 sudo，不经过 root Broker，也不增加服务账户权限。“读取”是 Action 的用途分类，不是对自定义命令的只读沙箱保证：管理员保存的命令可以修改服务账户权限内的数据。其他平台保留原生读取方式，命令编辑器显示不可编辑。

命令输出仍经模块解析及 Action 输出 schema 校验；格式错误会在刷新时报告。配置位于私有状态文件的 actionCommands 中，随已有状态备份/恢复；普通面板设置不会覆盖它。命令内容可能包含管理员自己的敏感参数，不应复制到公开日志或 Issue。

## 当前模块与原始输出

遵循 [模块规范](MODULE-DEVELOPMENT.md)。内置业务模块为 system/services，不支持不可信代码隔离。成功命令的 stdout/stderr/exitCode 只在当次响应保留，不持久化执行历史；Web 可查看，现有 MCP 仅返回 result。raw 可能含敏感内容，按结果数据保护。旧配置按 migrateFrom 映射，迁移不执行命令。

## 终端模块

terminal.execute 是显式 user-shell 写能力，仅普通服务身份，拒绝 root；已授权可信 MCP 客户端可直接使用。命令长度/超时/输出有界，非零退出作为命令结果返回。Web 真实 PTY 复用会话/Origin/CSRF，绑定登录会话，撤销后清理；有限连接/时长/缓冲，不持久化 history 或输出。它不增加服务账户权限，不调用 root Broker，其他写策略仍默认拒绝。详见 [TERMINAL.md](TERMINAL.md)。

交互终端使用面板 HTML 的随机 CSP style nonce，仅由面板组件给 xterm 动态样式使用；脚本策略仍为 self，不放开 unsafe-inline。HTML 不缓存。

## 普通用户文件操作

文件模块通过原生 fs API，以面板服务身份浏览、读写、上传、新建、重命名与删除，不通过 Shell 或 Broker，拒绝 UID 0。files.write/upload/create/rename/delete 为明确的 user-files 写策略，仅 Web 已认证管理员可经既有 CSRF/Origin 检查执行；MCP 暴露的 files.list/read 是已有可信个人客户端的读取能力，不是路径沙箱。文本保存检查 revision、保留权限/属主；上传创建新文件而不覆盖。删除目录会递归删除内容，GUI 要求确认；删除链接本身不删除目标。根目录不可删除或重命名。大小、分页与代理边界见 [文件管理](FILES.md)。路径、内容不写审计或公开日志。
