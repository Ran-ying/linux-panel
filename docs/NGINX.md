# Nginx 网站模块（阶段一：站点清单与配置检查）

此文档描述独立开发分支 `feat/nginx-site-inventory` 的首批功能，**不是已部署声明**。

## 能力和界面

- `nginx.sites`：扫描固定路径 `/etc/nginx/sites-available`、`sites-enabled` 和 `conf.d/*.conf`，识别启用目录中的文件/软链接，并提取有限的 `server_name` / `listen` 文本摘要。不会返回配置全文或证书内容；摘要不是 Nginx 完整语法解释器。conf.d 是否实际 include 由 nginx.conf 决定，因此标记为“配置候选”，不是必然启用。
- `nginx.check`：操作员手动执行固定 `/usr/sbin/nginx -t`，返回成功/失败、退出码、输出和运行身份。不 reload、不 restart、不修改任何文件。
- 两项只读 Action 使用通用 Web presentation（摘要卡、表格、检查结果），并以受信任 MCP 只读工具暴露；MCP 使用普通服务账户读取，因此无法读取的站点会显示警告，证书权限也可能造成 nginx -t 失败。

仅扫描固定配置树：每个目录最多 200 项，每个文件最多 256 KiB，链接解析后仍须位于同一配置树内，不跟随指向其它系统路径的链接，避免 root 侧任意文件读取。无任意路径、命令参数或文件正文输入。

## root 执行层

Web 在安装 `linux-panel-privileged` 后使用与文件管理相同的 root Action Client；平台 root 代码静态注册 `nginx.sites`、`nginx.check`，Ajv 再次校验无额外参数。旧版已部署的 root handler 不会因普通 Git 更新自动获得新 Action。

合并且 CI 通过后，需先审查安装包，再由管理员在测试机显式运行：

```bash
sudo bash /opt/linux-panel/scripts/install-privileged-executor.sh --enable
```

该安装器会重启 Panel 主服务和 root 执行器，但**不会重载 Nginx**。不要在此 PR 阶段对运行中的服务器执行安装脚本。

## 下一阶段（单独评审）

站点配置编辑、启用/停用和 reload 不在阶段一范围。后续应支持真实内容 revision 冲突保护、临时写入、`nginx -t` 失败回滚及独立显式确认，避免编辑过程中断开管理面板所在站点；不要给 root 开放任意 Shell 或无限制路径。
