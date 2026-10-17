# Linux Panel 当前状态

## 当前项目状态（2026-10-17）
- SSL 单边框修复：发现 .nginx-certificates 根层原为 section，受全局 aside,section 默认圆角边框影响，与 .config-ssl-section 形成双框。将内层替换为 role=region 的 div，并显式清零内层边框、圆角、背景、阴影、padding；测试验证唯一外框及内层计算样式（手机/桌面）。最终 CI、PR、部署及线上状态以 Issue #54 当次记录为准。
- 待 CI/部署：新增 Nginx 续期方式修复 `nginx.reconfigureRenewal`，仅对存量 standalone Certbot 证书调用受控 root `certbot reconfigure --nginx`，包含 staging 验证、备份、保存结果校验；仅暴露给认证 MCP，既有 root Actions 不放宽。见 [CERTBOT-RECONFIGURE.md](CERTBOT-RECONFIGURE.md)。
- 新开发（CI/部署待验收）：`services.logs` 使用固定 root-owned journalctl Handler，为已认证 Web / 受信任 MCP 提供 1–200 行只读 systemd 服务日志；原有 root 写入 handler 仍 Web-only。日志可能含敏感内容，不应进入仓库或审计。参见 [SYSTEMD-LOGS.md](SYSTEMD-LOGS.md)。
- 本轮待验收 UI 变更：网站 SSL 证书区域只有一个外层圆角带边框卡片，内部每张证书和每个 SAN 域名都去掉独立边框、背景及圆角；多个证书仅保留细分隔线。保留 Certbot 手动检查并续期逻辑；系统自动续期不由面板调度。本条属待合并源码说明，最终部署状态见 Issue #54。
- 本次交接界面调整：Nginx 网站基本信息保留名称标题，域名「移除」右对齐、域名下方「添加域名」为下划线文字；状态同行右侧显示「启用/停用」与「删除」下划线文字；第一列加粗、正文与操作常规字重且使用主题正文色。保留原二次确认、Nginx apply 的版本校验、语法检查与失败回滚。此条描述代码变更，准确 CI、PR 合并与实机部署状态需以 Issue #54 的当次记录为准。
- 当前开发 PR #168（合并/部署待验收）：Nginx 站点详情基本信息去掉「收起」，把删除配置文件移动至网站名称标题右侧；域名 / 域名及新增删除按钮、状态 / 状态值改为两行两列。域名增删实时保存到原网站 Nginx server_name：读取当前原文件和 revision，安全地解析所有一致的 server block，保留其它配置，防特殊语法/注入/歧义，交给原 nginx.apply 验证、重载和回滚；移除域名二次确认、添加输入和失败信息原位保留，最后一个域名不可删除。复杂多虚拟主机配置要求改用原有 Nginx 配置编辑器。浏览器和 Node 单元测试覆盖用户交互、版本冲突和不相关指令不变。
- 当前开发 PR #167（CI/部署待验证）：网站详情 SSL 只保留外层圆角背景卡片，单张证书条目取消内部圆角框（多张使用细线分隔）；第一块基本信息去掉「编辑」，第二块 Nginx 配置标题右侧提供「编辑」，点击后直接切为同卡片 textarea，原地「保存配置/取消」，不打开旧编辑弹窗；每次进入编辑先调用 nginx.read 获取最新正文与 revision，保存使用现有 nginx.apply 的版本锁、nginx -t 验证与回滚，409 和失败保留草稿，切换或收起前需要保存/取消。新建网站仍用弹窗。浏览器验收覆盖两种宽度及失败保留草稿、无隐式保存。
- 当前开发 PR #166（合并/部署待验收）：Nginx 网站详情由共用边框和散列文字改为独立的三个 12px 圆角背景矩形：①网站名称/域名/状态/编辑删除与收起；②实际 `nginx.read` 只读配置预览，滚动代码区，切换网站及 revision 更新时自动重新读取且拒绝过期响应；③该网站已有 SSL 证书管理。支持手机和桌面，保留站点及证书操作的显式确认，不在验收中改变生产站点配置。
- 当前开发 PR #165（CI/部署待核验）：修正 Nginx 状态管理里的服务操作、刷新状态及确认弹窗按钮，共用 Nginx 网站管理的全局 32px 胶囊按钮样式（包括背景、边框、字体、禁用状态），不再只有高度和内边距近似；将「刷新状态」移至状态管理标题右上角，与标题同一行，移除底部刷新栏；维持既有服务状态响应、启动/停止合并按钮及所有确认流程。浏览器回归在 390/1280 像素检查按钮计算样式严格一致和标题/刷新对齐。
- 当前开发 PR #164（CI/部署待验证）：Nginx 模块去掉独立可见 SSL Action，将 Certbot 证书功能嵌入每个**选中网站详情**，按该网站的 server_name 与证书 DNS SAN 关联；只有该网站匹配的证书列出续期按钮，未匹配时提示，不把域名匹配误称为实际生效 HTTPS。状态管理 Action 改 flat 无外圆角，内部状态卡片保留；按钮统一网站管理尺寸；启动/停止合并成随运行状态切换的一个按钮，二次确认逻辑不变。部署后需确认实际 root 状态、版本及无隐式 Nginx 变更。
- 当前开发 PR #163（CI/部署待验收）：在同一个「Nginx 网站」模块中新建两个可见 Action，顺序 **Nginx 状态管理（nginx.status）→ 网站管理（nginx.sites）→ SSL 证书管理（nginx.certificates）**，辅助 root Action `nginx.service` / `nginx.renew` 隐藏在对应卡片中。状态区显示 Nginx 版本、systemd 状态/自启、语法检查，并经二次确认执行固定服务操作。证书区安全读取 Certbot live→archive 公有证书的域名、颁发者、到期时间，手动确认只对现有证书执行标准到期续期，成功后检验并按需重载。保护私钥，初次签发/撤销/手动路径证书扫描不在本次范围；生产验收仅只读，不操作真实证书或 Nginx 服务。
- 当前开发 PR #162（合并/部署待验证）：V2Ray 入站连接、出站连接及旧版入站/出站扩展也改用与路由规则相同的「重命名」独立弹窗，按钮在「移除」左边。移除内联 tag 输入；弹窗只编辑显式 tag，缺失时空值，不按 protocol 回填；确认只改对应源数组候选 JSON，清空 tag 删除字段且标题回退，取消无更改。回归涵盖现代/旧版四类、既有与缺失 tag、取消/确定/清空、JSON 往返、无隐式保存。
- 当前开发 PR #161（合并/部署待单独验收）：V2Ray 左侧导航无共同背景，独立「添加字段」按钮，单独有背景和圆角边框的「完整内容」区，单独有背景和圆角边框的字段列表区；**仅字段列表自身滚动**，上方按钮和完整内容保持固定，整个 nav 与顶部编辑工具栏依然 sticky。浏览器验证两块卡片边框/背景、透明父级、独立滚动、移动端与桌面。只变动前端与测试/文档，不改真实 V2Ray 配置。\n
- **最近实机部署核验**：main `96ae79f5b8316ca3d3ad7ffc813f7b85a8e69de6`（[PR #159](https://github.com/Ran-ying/linux-panel/pull/159)）；受限 Broker durable success、Web/privileged/V2Ray/update.path active、HTTP 200、Git clean；后续交接见 [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54)。
- 本开发 PR（未合并/部署前不应宣称上线）：左侧仅保留根 JSON **实际存在的支持字段**，顶部独立「添加字段」按钮打开模态选择，仅显式确认后创建缺失项，完整内容下方增加间距。现代/旧版出入站依然分开；原有未知字段不丢失。
- 已检查 root V2Ray 保存逻辑：`read` 返回配置原始字节 SHA-256 作为 revision；`save` 对当前字节复算，不相等即 409 `配置已在外部修改`，防止并发覆盖。用户表示仅通过面板操作；不能断言外部程序修改。当前补强前端保存成功后立即记下新 revision，优先重读配置，摘要刷新失败不丢失同步；真正冲突仍保留草稿与 SHA 防覆盖。以一次成功保存后连续再次保存、模拟状态查询失败及真正冲突的浏览器/单元测试覆盖。**实际诱因尚未从用户现场页面确认**。
- 本次仅 Web UI/测试/文档，不触碰真实 V2Ray 配置、root Handler 或其服务。

## Telegram 个人账号 MCP（2026-10-17，开发分支未部署）

新增独立 `telegrammcp` 服务安装器、固定上游 Telethon MCP SHA、localhost Streamable HTTP 桥接、六个可见 Actions、`telegram.send`/`telegram.press` 的显式执行策略以及面板侧机器人白名单。模拟连接与权限测试通过；代码审查、CI 和合并状态以 [PR #143](https://github.com/Ran-ying/linux-panel/pull/143) 为准；**VPS root 安装、个人 Telegram 登录和真实机器人交互尚未完成**。具体配置与验收见 [TELEGRAM.md](TELEGRAM.md)，不能把代码与实机验收混为一谈。


更新：2026-10-16。v0.5.0 已发布，main 持续迭代。root 执行层已由 PR #112 合并进 main 697ff4698607008aa672c7db1164a39b9c4242b5，本轮补齐首次安装可选启用入口，关联 [Issue #111](https://github.com/Ran-ying/linux-panel/issues/111)。准确 CI、合并、普通 Web 部署与 root 激活证据统一见 [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54)。

## V2Ray 本机管理模块（2026-10-17）

新增基于服务器现有 V2Fly 5.47.0 的 V2Ray 6-Action 原生模块（状态、读取、校验、保存、服务、未安装时安装）。生产环境已部署并只读验证 `v2ray.status/read/test`，当前运行服务与配置未被更改；实际修改、重启等操作未用于生产冒烟测试。Web UI 保持无共同外框、四张独立状态圆角卡片；服务卡片内放启动/停止/重启，开机启动卡片内放开关，配置路径右侧放刷新按钮。下方使用左侧竖向配置列表（完整内容置顶）和右侧 JSON 编辑器，取消能力概览。分类切换保留未保存的有效编辑，非法 JSON 阻止切换，未改动的空缺分类不自动创建。准确 Git/CI、更新事务、只读验收见 Issue #54。更多限制和核验见 [V2Ray 模块](V2RAY.md)。

## 定时任务模块布局（2026-10-16）

纠正之前将 Cron 拆为两个侧边栏模块的实现：**仅一个「定时任务」模块**，内部始终上下展示**两张独立的顶层圆角卡片**：「Linux Panel 托管的定时任务」及「系统现有定时任务」，每张卡片内直接是标题、工具栏与表格，不嵌套卡片、不用页签，也没有包住两张卡片的额外圆角大框。两个部分仍使用原先受控 `cron.list/save/remove/systemSet` Actions、同一份数据；保留系统任务来源/用户/状态筛选，未迁移任何 Cron 文件。有关合并与生产验收，以 Issue #54 记录为准。

## 当前实现

- 通用 [root 执行层](PRIVILEGED.md)：PrivilegedActionClient、独立 Unix socket 服务、固定 root-owned handlers 与独立 Schema 验证。Web 仍普通账户，更新 Broker 保持独立；新 handler 需操作员安装，不动态加载模块目录。
- [文件管理](FILES.md)九个 Action：列表/文本读写/上传/新建/重命名/删除/chmod/chown。Web 可选 root，未配置时普通身份，配置后离线 503；MCP 文件工具保持普通身份。显示实际权限模式、可写状态，权限列可修改八进制 mode、用户/UID、组/GID。
- 启用即信任整个 linuxpanel UID，同 UID 终端、PTY、自定义 collectors 可直接调用受控 root 文件通道，Web-only 不是 OS 隔离。系统文件编辑是广泛 root 管理能力，不适合不可信模块/终端用户。
- 保持模块顺序持久化，模块管理可通用上下移动保存导航顺序（不硬编码业务模块名称）；文件权限弹窗所有账户下拉框统一使用内收箭头。新增 [Nginx 网站模块](NGINX.md)（PR #118）：列出站点、读取和编辑配置、创建/启停/删除、revision 冲突检查、nginx -t 验证、受控 reload 及失败恢复。单元、响应式浏览器及 disposable Ubuntu 真实 Nginx/root handler/HTTP 204 验收通过（CI 38936982003）；仍须分别确认合并、普通代码部署、root 包显式更新和真实 Web 操作，不把代码合并等同于目标机已经启用；Cron 定时任务模块支持独立配置文件的任务浏览/创建/编辑/启停/删除及通用 Web 编辑器（PR #117）。新的 Cron root handler 仍需目标机显式重新安装，不能根据源代码合并或普通 Web 更新宣称 Cron 已可用。文件两排行导航、MB 两位小数、日期时间分行、Action 极简文件展示、目录大小按需统计。资源/基本信息两 Action，服务本地筛选，真实交互终端，共享 ActionEngine/MCP 参数协议保持。

## 验证与部署

本轮增加独立 root /etc 与 /root 临时对象验收、跨 UID/group socket 权限、HTTP 鉴权/CSRF、未知操作/错误输入拒绝、MCP 普通身份、根通道离线不降级，以及权限编辑浏览器回归。本机运行环境禁止监听 Unix socket，不能把本地语法/构建与无 socket 测试写成 IPC 验收通过；完整 CI 是必要证据。

2026-10-16 实机复核：独立 linux-panel-privileged.service 和普通 linux-panel.service 均为 active，socket 组为 root:linux-panel-privileged。以 linuxpanel 运行已有 verify-privileged-executor.js，/etc、/root 的随机临时文件创建、读写、版本冲突、chmod/chown、重命名和清理全部 PASS。新装仅在显式 --enable-privileged 后自动启用 root 文件 Actions；默认仍不安装，已有主机不需要重新安装应用。具体 CI/PR 与部署证据见 Issue #54。

下一步：Nginx root 包显式升级与实际受控 Web 操作验收、真实 iPhone/Android QA、其它模块。Nginx 语法和 reload 检查不保证公网代理/HTTPS 上游的端到端健康；异常断电无 Nginx 独立恢复日志。没有不可信插件沙箱、多管理员或独立安全审计。

## 固定 root systemd 权限在线修复

在修复旧版 AF_UNIX 单元模板（PR #121）后，新增固定 `nginx.repairExecutor`：
`status`（仅查有效权限）→ `stage`（写固定 root drop-in + daemon-reload，
不重启）→ `restart`（只调度特权 executor 本身重启）。
它不接收文件路径/单元名称/自定义命令，仍走现有 Web-only root Action。
合并与现场激活需另行确认；只更新 Handler 不会自动修复旧 unit。

## 受控 root 包自动更新（PR #120）

通用 manifest + 版本化 root-owned releases + 原子 current 切换，作为可信 origin/main Broker 部署事务的一部分，出错时与 Web 一并恢复。**2026-10-16 现场核查**：测试 VPS main 为 `8d31bbd55e061942f587cb0e778bfe88feece327`，版本化 root releases 中存在相同 SHA，`nginx.sites` 和 `cron.list` 已由实际 root socket 成功执行，说明一次性迁移已完成且 root Handler 同步生效。**已发现的独立缺陷**：已安装的特权 unit 仍只允许 `AF_UNIX`，实际 `nginx.check` 返回失败（禁止 AF_INET socket）；修复见后续 Nginx root unit 回归 PR。版本化 Handler 更新不等于 root unit 自动升级；现场修复必须对 unit 另行安全激活，不能靠重发普通 Broker 更新假定生效。
