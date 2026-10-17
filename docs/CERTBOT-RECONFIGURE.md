# Certbot 自动续期方式迁移

为修复已有的 Certbot `standalone` 证书与运行中的 Nginx 争用 80 端口，新增窄范围 Action `nginx.reconfigureRenewal`。此 Action **不是通用 root 终端**，仅向认证的个人 MCP 客户端暴露，在固定 root Handler 中执行。

输入：`{"name":"现有 Certbot 证书名称"}`。仅接受安全文件名、真实普通文件 `/etc/letsencrypt/renewal/<name>.conf`，且其 `[renewalparams]` 的 `authenticator` 必须为 `standalone`；有自定义 pre/post/deploy hooks 的配置拒绝自动迁移。若已为 `nginx` 则直接返回成功而不修改。

执行前在同目录保存只读管理备份 `*.before-nginx.<timestamp>-<nonce>.bak`，权限 0600。然后通过 `execFile` 调用固定的 `/usr/bin/certbot reconfigure --cert-name <name> --nginx --non-interactive`，最长 180 秒，无 Shell 或用户提供的参数。Certbot 的 `reconfigure` 会先通过 ACME staging 验证新配置；成功后才提交真正的 renewal 参数。读取保存后的 renewal 文件确认 `authenticator = nginx`，未通过则报告失败。不会停止 Nginx，且不强制签发正式证书。

**变更行为与局限：** Certbot Nginx 插件可能临时写入/回滚其挑战配置并重载 Nginx，以完成实际 HTTP-01 验证。由于 Nginx 包含现有域名和监听规则，成功并非保证；必须根据每个证书的 Action 结果进行核验。迁移后可在合适的时机运行 `certbot renew --dry-run` 验证整体行为；真实自动续期仍由 `certbot.timer` 负责。不要将 renewal 配置中的 account 或 ACME 日志、令牌内容写入公开 GitHub Issues。

生产使用需版本化 root 包、Web 和 MCP 在同一已合并 SHA 完成部署。旧的 Web-only root Handler 仍对 MCP 拒绝；只针对明确 ID 的该迁移 Action 加入 MCP 写入口。整个操作会修改 Certbot 配置，因此必须由用户授权后执行。