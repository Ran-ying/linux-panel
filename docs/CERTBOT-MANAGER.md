# Certbot 证书管理与 Nginx TLS 引用

Linux Panel 将 **Certbot 证书管理** 作为「Nginx 网站」模块内，与 **Nginx 网站管理同级的独立 Action 卡片** 展示；不占用侧边栏模块，也不嵌套在网站管理组件内部：
- `nginx.certbotList`：读取 `/etc/letsencrypt/renewal/*.conf` 中实际登记的自动续期证书，配合已解析的公开证书有效期与验证方式，并显示系统 `certbot.timer` 的启用和运行状态。
- `nginx.certbotRenew`：管理员在 Web 二次确认后，仅针对登记的证书执行原有受控 Certbot 检查续期，不强制提前签发。成功时按既有 Nginx 校验/重载规则处理。
- 该区域不接管系统计划任务，不自动删除证书、不提供新证书签发功能。
- Certbot 管理区仅有一个外层圆角卡片；各证书记录使用分隔线，不嵌套圆角边框。网站详情自己的 TLS 证书与私钥显示仍保留，二者不是同一数据源。

原网站内 **SSL 证书管理** 不再按 SAN 域名猜测关联 Certbot 证书。现在：
- `nginx.siteTls` 只查看所选网站 `/etc/nginx/sites-available/<name>` 文件中直接声明的 `ssl_certificate` / `ssl_certificate_key`，对齐为一组或多组实际引用。
- 页面固定左右 50% 双栏、列间距 0：左侧第一行显示 Nginx 引用的证书路径，下方 **可编辑的 CERTIFICATE PEM 文本框**；右侧第一行显示私钥路径，下方 **正常显示可编辑的 PRIVATE KEY PEM 文本框**；左右各自底部有「保存」按钮。
- `nginx.siteTlsKey` 仅对已登录 Web 管理员提供，不暴露 MCP；在展开网站 SSL 详情时自动读取私钥，退出详情即丢弃内存中的密钥草稿。后端仅允许读取真实路径位于 `/etc/letsencrypt/archive` 或 `/etc/ssl` 的有效 PEM 文件，并限制读取大小。Web 请求受会话、CSRF、同源要求和 no-store 策略保护；特权日志不得包含私钥内容。
- `nginx.saveTls` 是仅允许已认证 Web 的受控 root 写入 Action。校验原证书与私钥的 CAS 版本、证书/私钥算法匹配、证书域名不变；只允许写回 Nginx 站点已引用的可信 PEM 路径，采用原位可回滚的原子替换、`nginx -t` 及必要的 Nginx reload。两侧同时编辑可一次性提交匹配的一对 PEM；失败恢复原内容。保存不会改变 Certbot 自动续期配置，Certbot 后续续期可能替换这些文件，通常应由 Certbot 处理签发和轮换。
- Nginx 配置中通过 `include`、变量或非字面量路径继承的 TLS 引用不推断；会显示限制提示。该区域展示的是 Nginx **站点文件内直接声明的引用**，而不是代替 `nginx -T` 的完整生效配置解析器。

*私钥是敏感数据：它在管理员打开网站详情后直接显示，需确保面板仅供授权人员访问，并避免将其复制到 Issue、日志、截图、共享记录或第三方服务。*
