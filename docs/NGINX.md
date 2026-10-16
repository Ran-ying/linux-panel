# Nginx 网站管理

Nginx 模块提供受控配置管理，而不是直接开放 root shell。模块依赖现有 ActionEngine、可选独立 root executor 和面板管理的 \`managed-configs\` 展示组件。

## 操作与权限

| Action | Web | MCP | 说明 |
| --- | --- | --- | --- |
| nginx.sites | 是（可选 root） | 普通账户 | 列出 sites-available、sites-enabled、conf.d/*.conf |
| nginx.read | 是（可选 root） | 不暴露 | 按安全文件名读取站点内容和 SHA-256 revision |
| nginx.check | 是（可选 root） | 普通账户 | 固定 /usr/sbin/nginx -t，不修改状态 |
| nginx.apply | 仅认证 Web root | 不暴露 | 创建、编辑、启用、停用、删除 |

写操作要求管理员在新版本部署后**另外显式安装** root handler：
\`\`\`sh
sudo bash /opt/linux-panel/scripts/install-privileged-executor.sh --enable
\`\`\`
会重启 root executor 和 Linux Panel Web，不会更改 Nginx 配置本身。普通 Git/MCP 更新**不会**自动替换 root-owned 处理器。没有安装 handler 时，Web 写入会返回 503 或不支持的 Action 错误，不会降级至普通 Shell。

## 功能

- sites-available 中符合安全文件名规范的常规文件可编辑；不会修改 nginx.conf、证书、conf.d、其它配置树或非同名的站点链接。其它位置的配置只列出摘要并标记为只读。
- 文件名只接受英文数字开头的 ASCII 字母数字、点、下划线和短横线；不接受斜杠、路径跳转或任意命令。
- 站点表格的状态列使用复选框：勾选为启用、未勾选为停用；点击后先打开二次确认，取消时不改变状态、不发送启停 Action，确认后才提交。列表不再显示单独的启用/停用按钮；编辑和删除仍在操作列。非受管配置的状态复选框禁用；conf.d 状态不确定时显示中间态。
- 编辑与启停前重新读取 revision，防止过时页面直接覆盖其它更改。
- 文件内容为最多 64 KiB 的有效 UTF-8 文本；更新用同目录排他临时文件、权限/属主保留和 rename。
- 新建站点默认**不启用**；启用/停用创建或删除 \`sites-enabled/<name>\` 中指向 \`../sites-available/<name>\` 的符号链接。其它链接目标和常规文件不接管。
- 每次变更后检查 Nginx 语法；失败即恢复原文件与链接。影响启用站点的操作成功通过 \`nginx -t\` 后才调用固定 \`systemctl reload nginx.service\`。重载失败会恢复文件，尝试重新加载原配置并报告状态。
- 重载失败、进程崩溃或系统断电不能保证恢复系统运行状态；**这是同步操作中的最佳努力恢复，并非持久化恢复日志或真正的跨进程事务**。务必事先了解主机恢复渠道。

## systemd 权限

`nginx -t` 会在检查已有 listen 指令时创建 AF_INET/AF_INET6 socket，即使它不会对公网启动新的 Nginx master。root executor 因而允许 `AF_UNIX AF_INET AF_INET6` 和 `CAP_NET_BIND_SERVICE`，保留其它 systemd 沙箱约束；这项扩大需单独审查并由操作员显式重新安装固定 root handler + unit 生效。未启动任意 TCP 服务，业务 Action 不接受网络地址参数。

## 受控 root unit 自修复（一次性兼容迁移）

版本化 root 包通过已授权 main Broker 更新自动安装；若旧主机的
`linux-panel-privileged.service` 仍只允许 AF_UNIX，`nginx.check`
会失败。修复 Action `nginx.repairExecutor` 不接受任意路径、命令、
systemd 单元名或内容，只有固定确认短语与 `status`/`stage`/`restart` 三种模式。
它被标记为 Web-only privileged write，而用户可信的 linuxpanel UID
终端也可连接固定 root socket 执行该 Action。

`stage` 仅安装固定的 systemd drop-in，`systemctl daemon-reload`
并核实有效权限，不立即重启；`restart` 校验成功后只以
`systemctl --no-block restart linux-panel-privileged.service` 重启
自身。MCP 连接可能暂时中断；请求确认前务必先核验 socket、
重新调用 `nginx.check`。固定覆盖文件冲突或单元与审核格式
不符时拒绝覆盖。该修复不更改 Nginx 站点、配置、证书或 nginx.service。

## 重要限制

目录清单是有限的文件扫描：每目录上限 200 项、每配置文件 64 KiB。解析出 \`server_name\`、\`listen\` 的字符串**仅为摘要**，并非完整 Nginx parser 或 \`nginx -T\` 生效配置。尤其 conf.d 仅是配置候选，需看 nginx.conf include。启用的站点还可能因 include 或其它复杂条件实际不生效。

停用站点会删除已认可的同名启用软链接，并在 nginx -t 通过后重载；已有连接一般不会立即断开。有效 Nginx 语法不保证上游后端、HTTPS、域名、面板管理入口能够工作。当前不提供 HTTP 健康检查、TLS 证书管理、自动签发、access/error log 浏览、备份版本历史、reload 后端服务恢复，也不承诺对并行外部写入绝对事务隔离。

测试必须在临时 Nginx 目录和命令替身完成，不能修改生产站点、重载生产 Nginx 或使用任意 root Shell。项目的 Nginx 配置可与面板共存，但不能由面板安装器接管。
