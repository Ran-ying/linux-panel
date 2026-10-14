# 公开仓库前审查

此仓库目前是 Private。**Private → Public 会暴露现有代码、历史提交、PR 和可见的 CI 日志**。因此只能在完整历史审查之后进行，而不能只扫描 main 当前版本。

## 公开前核查

- [ ] 使用 Gitleaks 或 TruffleHog 对 **所有分支、历史提交** 扫描凭据。
- [ ] 检查旧提交、PR、Actions 日志、附件是否涉及真实 IP、OAuth、SSH 密钥、Token、Cookie、账号数据等。
- [ ] 对曾泄露的凭据进行轮换和吊销；删除代码里的字符串并不能让已泄露凭据失效。
- [ ] 区分公开示例 `panel.example.com` 与私人部署；不要将私人状态文件、环境文件或备份提交。
- [ ] 审核依赖许可证、本项目 [LICENSE](../LICENSE) 和外部代码来源。
- [ ] 使用一台新的受支持 Ubuntu/Debian 机器验证 [INSTALL.md](INSTALL.md) 和 `scripts/install.sh`。
- [ ] 验证 Nginx 的登录/OAuth 限流、HTTPS、默认关闭的 MCP 与 Action 白名单。
- [ ] 标注尚未提供：多管理员 RBAC、2FA、特权操作、独立安全审计。

README 曾包含私人测试实例域名，相关历史提交仍可能保留。公开前必须接受这一点，或从审查后的干净源代码创建**新的公开仓库**，不带私人开发历史。

无需公开也可以部署：对私有仓库使用逐机只读 Deploy Key，或向受授权的用户分发构建包。公开只是降低陌生用户获取代码的门槛。

注意：`package.json` 中的 `"private": true` 表示禁止发布到 npm，并不控制 GitHub 的 Public/Private 可见性。
