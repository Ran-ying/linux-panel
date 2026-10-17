# Nginx 服务、网站与 SSL 证书管理

Nginx 模块提供受控配置管理，而不是直接开放 root shell。模块依赖现有 ActionEngine、可选独立 root executor 和面板管理的 \`managed-configs\` 展示组件。

## 操作与权限

| Action | Web | MCP | 说明 |
| --- | --- | --- | --- |
| nginx.status | 是 | 不暴露 | Nginx 版本、运行状态、开机自启、语法检查 |
| nginx.service | 仅认证 Web root | 不暴露 | 固定 nginx.service 的启停、重启、重载、开机自启控制；先检查配置 |
| nginx.sites | 是（可选 root） | 普通账户 | 列出 sites-available、sites-enabled、conf.d/*.conf |
| nginx.read | 是（可选 root） | 不暴露 | 按安全文件名读取站点内容和 SHA-256 revision |
| nginx.check | 是（可选 root） | 普通账户 | 固定 /usr/sbin/nginx -t，不修改状态 |
| nginx.apply | 仅认证 Web root | 不暴露 | 创建、编辑、启用、停用、删除 |
| nginx.certificates | 仅认证 Web root | 不暴露 | 只读 Certbot 公有证书、域名、颁发者、有效期 |
| nginx.renew | 仅认证 Web root | 不暴露 | 明确确认后，针对已有 Certbot 证书进行到期续期及 Nginx 配置检查/重载 |

写操作要求管理员在新版本部署后**另外显式安装** root handler：
\`\`\`sh
sudo bash /opt/linux-panel/scripts/install-privileged-executor.sh --enable
\`\`\`
会重启 root executor 和 Linux Panel Web，不会更改 Nginx 配置本身。普通 Git/MCP 更新**不会**自动替换 root-owned 处理器。没有安装 handler 时，Web 写入会返回 503 或不支持的 Action 错误，不会降级至普通 Shell。

## 网站详情独立三区布局

网站列表旁（手机端在列表下方）的详情区**不再使用共用背景或左侧分隔边框**，而是三个依次排列、有间距的独立圆角矩形：

1. **网站基本信息**：网站名称位于顶部，顶部只显示站点名称，不放「删除」或「收起」按钮；**域名 / 域名列表、状态 / 已启用或已停用**保持左侧标签、中间正文、右侧操作的两行布局。每个域名的「移除」位于该行最右侧，「添加域名」位于域名列表下方；状态右侧是「停用/启用」与「删除」操作。标签使用正文大小加粗，域名/状态值及所有操作使用正文大小常规字重、主题正文色；上述操作只显示下划线文字，不使用胶囊背景、边框或圆角。手机端同样保持左右对齐。可编辑站点可「添加域名」或对各个域名「移除」（移除需再次确认）；操作基于服务器当前 `nginx.read` 原始内容和 revision，安全改写该站点 `server_name` 再调用原有 `nginx.apply` 做 Nginx 语法验证、受控重载及失败回滚，绝不只更改前端显示。相同的多个 `server` 块同时更新；包含复杂指令、特殊名称或不同 `server_name` 列表的配置将拒绝自动修改并指引用户前往完整 Nginx 配置编辑器。拒绝插入危险参数、重复域名、删除最后一个域名，版本冲突不覆盖外部修改；添加失败保留输入。Nginx 配置与域名操作的编辑模式相互排斥，删除配置文件仍需二次确认；列表中点击所选网站即可取消选择。
2. **Nginx 配置**：通过 `nginx.read` 加载当前真实配置，代码块滚动显示。**「编辑」按钮移入本区域标题右侧**，点击时再次读取最新 `content + revision`，原地用等宽 `textarea` 替换代码预览，内联显示「取消」和「保存配置」。取消仅丢弃草稿；保存仍走现有 Web-root `nginx.apply` 的按 revision 防并发覆盖、`nginx -t` 验证及失败恢复；保存失败/409 原地展示错误并**保留未保存的编辑内容**。切换网站前必须先保存或取消编辑。新建网站仍沿用原有弹窗。无论是否编辑，浏览和读取都不会自动写服务器。
3. **SSL 证书管理**：只保留详情区**一个外层圆角卡片**；证书内容布局根元素也不使用 section 通用外框，且显式清除边框、圆角、内边距和背景；证书条目及其内部域名标签同样没有额外背景、圆角或边框，多个证书只以细分隔线区分。保留 Certbot 公有证书 SAN 域名关联、有效期和手动确认续期流程。自动续期由主机的 Certbot systemd timer/系统计划任务独立负责，并不由该 Web 卡片调度。

三个矩形各自带边框、背景、12px 圆角，桌面和移动端均垂直堆叠；没有更改 Nginx root 写入、服务控制或真实证书。

## 状态管理与网站内 SSL 证书管理

Nginx 网站模块只有两个独立区块：**Nginx 状态管理 → Nginx 网站管理**；SSL 证书管理不再是独立 Action 卡片，而是打开具体网站详情后显示在该网站的右侧详情（手机端在列表下方）。辅助 Action（`nginx.service`、`nginx.certificates`、`nginx.renew`、`nginx.check`、`nginx.read`、`nginx.apply`）在对应区块内调用。

- **状态管理**外层不再用圆角矩形容器（flat），内部状态卡片保留；**刷新状态**置于本区块标题右上角，与标题同一行（窄屏自动适配），移除底部刷新按钮；所有状态操作、刷新和确认弹窗按钮直接共用网站管理的全套 32px、.85rem、999px 胶囊按钮 CSS（尺寸、边框、圆角、背景、字体与禁用状态一致），不再覆盖为旧版矩形按钮。启动/停止合并为同一按钮：运行中「停止」，停止时「启动」；其它重启、重载、启停自启仍单独存在，变更先二次确认。显示内核版本、systemd 服务状态/子状态、开机自启及配置语法结果，提供刷新、检查配置；启动、重启、重载前先运行固定 `nginx -t`，不允许自定义 systemd unit 或 Shell 参数。
- **每个网站详情内 SSL 证书管理**仅在网站详情展开后读取受管证书，从网站 Nginx 站点文件实际声明的 `ssl_certificate` / `ssl_certificate_key` 路径读取证书与私钥引用，不通过 SAN 域名推测。未匹配时显示无匹配证书，不显示别的站点的续期按钮。**域名匹配仅用于关联展示，不能证明 Nginx 当前引用了该证书**；不因打开网站写文件或自动申请/续期。受管公有证书只读取实际声明且位于受支持证书根目录的 PEM 文件，要求真实证书链的目标在 `/etc/letsencrypt/archive/` 内；以 Node.js X509Certificate 解码公有证书，显示名称、SAN 域名、颁发者、签发/过期时间、距离到期天数及公有证书路径。**不会在列表中自动读取私钥；仅登录 Web 管理员明确点击后临时读取已引用的合法 PEM 私钥，不向 MCP 暴露，不写入日志。** 本模块不会声称包含所有系统自定义证书。
- 独立 Certbot 证书管理模块每条已登记续期证书有「检查并续期」，二次确认后使用固定 `/usr/bin/certbot renew --non-interactive --cert-name <已列出的安全名称>`，不强制提前续期、不接收任意域名/目录/脚本；成功后若 Nginx 运行，则先检查 Nginx 语法，成功再重载；若 Nginx 停止，不自动启动。既有 Certbot renewal 配置自身的验证方式、hooks 和域名解析必须事先正确。本阶段**不支持创建/撤销证书**，因为签发需要单独选择 HTTP-01/DNS-01 与对应服务商凭据；不会替用户猜测。
- 生产部署验收只读取状态，不执行停止、重启、申请或续期，也不更改已部署的 Nginx 配置。

## 功能

- sites-available 中符合安全文件名规范的常规文件可编辑；不会修改 nginx.conf、证书、conf.d、其它配置树或非同名的站点链接。其它位置的配置只列出摘要并标记为只读。
- 文件名只接受英文数字开头的 ASCII 字母数字、点、下划线和短横线；不接受斜杠、路径跳转或任意命令。
- 网站管理采用左侧网站列表 + 按需显示的详情布局。初始只显示一列网站；配置文件名下方逐行显示关联域名，不显示 `sites-available` 等内部位置标识。点击某个网站才出现右侧详情（窄屏在下方），其中包含编辑和删除操作；再次点击或选择“收起”隐藏详情。列表及详情暂不显示监听字段，也没有独立的操作列表列。底部冗长说明已移除。
- 网站列表中的状态复选框：勾选为启用、未勾选为停用；点击后先打开二次确认，取消时不改变状态、不发送启停 Action，确认后才提交。非受管配置的状态复选框禁用；conf.d 状态不确定时显示中间态。
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

停用站点会删除已认可的同名启用软链接，并在 nginx -t 通过后重载；已有连接一般不会立即断开。有效 Nginx 语法不保证上游后端、HTTPS、域名、面板管理入口能够工作。当前不提供 HTTP 健康检查、自定义路径证书自动发现、初次签发或撤销、access/error log 浏览、备份版本历史、reload 后端服务恢复，也不承诺对并行外部写入绝对事务隔离。

测试必须在临时 Nginx 目录和命令替身完成，不能修改生产站点、重载生产 Nginx 或使用任意 root Shell。项目的 Nginx 配置可与面板共存，但不能由面板安装器接管。


关于独立 Certbot Action、Nginx TLS 双栏、私钥按需查看的边界参见 [CERTBOT-MANAGER.md](CERTBOT-MANAGER.md)。


### 删除网站时自动清理 Certbot 证书

删除 Nginx 网站不再单纯移除配置文件。已有的 `nginx.apply` 的 `operation=remove` 保持原来的站点版本确认、Nginx 配置检查和必要时的重载；成功后对该网站中**直接引用**的 Certbot `live/<cert-name>/cert.pem` 或 `fullchain.pem` 查找真实的续期档案，并检查 Nginx `nginx -T` 的生效配置和 `sites-available` 中仍存在的网站。若证书确实未被其他 Nginx 网站使用，使用固定参数的 `certbot delete --cert-name <name> --non-interactive --quiet` 同时清理证书及自动续期档案，**不显示额外删除选项**。

证书共享、来源不属于注册的 Certbot 续期档案、其他网站引入了无法确定的配置、扫描失败、Certbot 删除失败时，均**保留证书**并在返回的结果消息中提示。证书删除是不可撤销步骤，故只有网站删除、`nginx -t` 和必要时重载成功后才执行；不会在 Nginx 失败回滚期间触发。域名从网站 `server_name` 单独移除以及网站停用 **不触发**证书清理。若 Certbot 删除失败，网站删除仍算成功，但结果显示证书已保留、需要检查。参考 `tests/nginx-certbot-cleanup.test.js`。


### 新建网站：可视化 / Nginx 配置双模式

在 Nginx 网站管理中点击「新建网站」，默认打开 **可视化**：支持填写一个或多个监听域名（可填写公网 IPv4，作为 `server_name` 匹配条件）、从当前主机网络接口实时读取的「监听 IP」下拉框（保留 `0.0.0.0` / `127.0.0.1`）、监听端口，以及静态网站 / 反向代理网站类型。静态网站生成 `root <绝对路径>` 与 `index index.html`；反向代理生成 `location /` + `proxy_pass <http(s) URL>` + Host / 真实 IP / Forwarded 头，**不附带 root**。监听 IP 仅接受当前服务器实际网卡地址或通配地址，公网域名/IP（`server_name`）不是 `listen` 绑定地址。另保留手写 **Nginx 配置** 模式，供高级配置（TLS、自定义 locations 和附加模块）使用；手写草稿不会被视图切换自动解析。创建时可留空文件名，自动采用第一个域名/IP。

新站点沿用已有 `nginx.apply create` 受控 root 流程，Nginx 语法检测失败回滚，且 **创建后默认停用**；在列表中明确启用后才会接管端口请求。选择 443 端口不会自动签发证书或开启 TLS。`root /var/www/html;` 仅对**静态站点**有意义：它让 Nginx 从这个本地目录读取文件。只反向代理时不必出现 `root`。详见 `apps/web/src/nginx-site-create.js` 及 `tests/nginx-site-create.test.js`。
