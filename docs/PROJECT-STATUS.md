# Linux Panel 当前状态

## 当前项目状态（2026-10-17）

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
