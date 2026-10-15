# Linux Panel v0.4 安全边界

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
- 特权服务 Broker、带审批的 Shell 或写入权限。
- OAuth Client ID Metadata Documents（CIMD）等全部可选客户端发现方式。
- 跨各种操作系统、Nginx/CDN 组合的独立生产验收。

已有 ChatGPT MCP 实际只读调用成功，但这不是所有客户端的兼容性或安全保证。

私有状态、Token、配置和凭据不应该出现在 Git、构建日志、公开 Issue 或网页静态目录。公开仓库前请阅读 [PUBLIC-RELEASE.md](PUBLIC-RELEASE.md)。

## v0.5 新增威胁模型

见 [THREAT-MODEL.md](THREAT-MODEL.md) 和 [UPDATER.md](UPDATER.md)。新 Broker 的部署测试仍需要受控服务器实际验证；CI 不构成生产安全认证。

## Web 登录有效期

默认有效期为 30 天（固定天数，不按自然月）。在“面板设置 → 登录会话”可设置 1–365 天。保存后当前设备从保存时刻重新计时，后续登录使用新值；其他设备既有会话不变。会话服务端到期时间与 HttpOnly/SameSite/Secure Cookie 的剩余有效期同步；普通刷新不会无限续期。

升级前仍有效的旧 12 小时会话，在下次加载会话信息时按原创建时间与配置天数升级一次，并更新 Cookie。已过期、撤销或因密码变更失效的会话不会恢复。策略存储在私有状态中；更新经过登录、管理员权限、Origin 和 CSRF 校验并记录审计。
