# Linux Panel v0.4 安全边界

这是一个实验阶段的自托管服务器管理项目，**代码/CI/本地 OAuth 集成测试不等于独立渗透测试或生产安全认证**。

## 已有防护

- 管理员由服务器 CLI 交互初始化，无默认密码、无 Web 自助注册。使用 scrypt 密码哈希；v0.5 支持可选 TOTP 双因素认证、一次性恢复码和按账号/IP 组合的登录限流。
- Web 会话使用随机令牌和 HttpOnly / SameSite Cookie，生产 HTTPS 使用 Secure。私有状态文件模式 0600。
- 生产验证 Host、来源 Origin、CSRF；只信任回环来源的 Nginx 代理头。
- API 绑定 `127.0.0.1`，对公网只开放 Nginx HTTPS；设置 CSP、HSTS 和其他响应头。
- MCP 默认关闭，新客户端注册与每个 Action 白名单均默认关闭。
- OAuth Authorization Code + PKCE S256，Token 绑定 MCP 资源，客户端 Scope 与用户权限和 Action 白名单取交集；撤销/密码变更导致旧授权失效。
- MCP 提供只读系统信息。v0.5 可选的 `panel.update.request` **仅创建准确 Git SHA 的更新申请**，必须先授予独立 OAuth Scope 并由 Web 管理员重新输入密码确认；若管理员已启用 TOTP，还须输入新的动态验证码；实际更新由单独安装、root 固定脚本 + 非 root 构建账号执行，不开放任意 SSH Shell。
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
