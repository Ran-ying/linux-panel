# 文件分块传输（2026-10-20）

文件管理的上传和下载改为 1 MiB 分块流，支持断点续传和 HTTP Range。同名文件覆盖，同名目录合并。全局请求体限制没有放宽到整文件大小。若前面有 Nginx，需要在 `/api/files/` 上允许约 2 MiB 请求体并关闭请求缓冲；仓库模板已更新，已经部署的 vhost 要由管理员自行合并，面板不会改 Nginx。

已启用 root 执行器的机器，在普通面板更新之外，还要让固定 root 包包含新的 `files.transfer`。已迁移的更新 Broker 会在下一次可信 main 部署里同步该包；尚未迁移的机器仍要显式重装 root 执行器。root 通道在线但 handler 过旧时，上传不会退回普通账户。详见 [FILES.md](FILES.md) 和 [PRIVILEGED.md](PRIVILEGED.md)。

# 自动升级受控 root handler（需要一次初始迁移，2026-10-16）

旧版本的 `linux-panel-update-worker` 是 root-owned 固定程序，因此普通 Web/MCP 更新**不能**自行安装新的 Broker 权限。将本版本源码通过现有授权 Broker 正常更新后，使用 VPS root/sudo 终端执行**一次**：

```bash
sudo bash /opt/linux-panel/scripts/enable-privileged-auto-updates.sh --check
sudo bash /opt/linux-panel/scripts/enable-privileged-auto-updates.sh --enable
```

脚本要求干净的 main、remote pin 一致、已有可用 root Broker 和 root Action 服务且没有未完成恢复事务。它暂时停止更新 watcher，安装与当前 SHA 对应的 versioned root handler（自动包括 Cron/Nginx）、更新 root-only Broker worker 及其 systemd sandbox 配置，最后恢复 watcher；不改变管理员密码、MCP 策略、其他服务或现有 Cron/Nginx 配置。`--check` 只读。**未来**更新可信 main 会使用固定 manifest 自动 stage/切换/回滚 root handler 文件及 Node 依赖，不开放任意 root 命令；若升级系统服务权限/单元，仍需明确独立安装。源码合并和普通 Web 更新成功不代表旧 root 包已同步。


# 托管 Cron 模块（2026-10-16，开发中）

增加 `cron.list/save/remove` 与 Web 定时任务编辑器。仅管理 `/etc/cron.d/linux-panel`，执行用户固定 `linuxpanel`，不覆盖非面板管理的 crontab。新的固定 root handler **不随普通面板更新安装**；在信任该版本源码、确认 Cron daemon 运行且完成部署授权后，需由管理员另行运行 `sudo bash /opt/linux-panel/scripts/install-privileged-executor.sh --enable`，否则 Cron 操作返回 503/未注册。不可将 main 更新成功误报为 Cron root 安装成功。详情见 [CRON.md](CRON.md)。

# 可选 root 执行层与文件权限编辑（Issue #111，2026-10-16）

新增独立 PrivilegedActionClient/Unix socket/root executor，以及 files.chmod/chown。普通 main 更新只部署客户端和 UI，不自动安装新 root 服务。要启用系统级文件管理，操作员在更新后执行一次 sudo bash /opt/linux-panel/scripts/install-privileged-executor.sh --enable。root handlers 与 Ajv 复制为 root-owned 固定包；以后新增/更新 root handler 也需重跑此安装命令，不动态加载 Web 可写源目录。

文件列表新增 accessMode: root/user，writeAccess 按实际执行身份计算。Web opt-in root，未配置走普通身份，配置后通道离线返回 503；MCP 文件读取仍普通。重要：同 UID 终端/PTY/采集器属于已信任通道，能直接调用固定 root 文件操作。具体边界与关闭命令见 [权限执行层](PRIVILEGED.md)。下方普通文件模式历史说明仅描述 root 未启用时的行为。

# 文件管理扩展与模块顺序（2026-10-16）

模块导航首次升级自动建立“系统概览 → 服务浏览 → 终端 → 文件管理”顺序，保存在私有 state.moduleOrder；后续新增 ID 追加末尾，现有顺序和暂时移除模块的位置保留。不需要手工迁移状态或修改前端。

新增 files.create/rename/delete，和 write/upload 一样仅 Web、普通服务账户执行，MCP 读取清单不变。目录项增加 permissions（八进制）、owner（用户:组）、sizeComplete；size 可为 null。GUI 统一以十进制 MB 显示，目录递归统计普通文件逻辑字节，不遍历链接，预算不足或权限失败显示部分统计。支持多文件选择和拖入上传、新建文件/文件夹、同目录重命名、确认后删除文件或非空目录。详见 [文件管理](FILES.md)。

# 文件管理与本地筛选（2026-10-16）

基本信息关闭每 15 秒自动刷新。服务筛选改为 Web 对已读数据即时过滤，输入/选择条件不再发请求，只有刷新重新采集；API 的可选筛选参数继续兼容。

新增 files.list/read/write/upload。前两项可供可信 MCP 读取；写入和上传仅 Web、普通服务账户、拒绝 UID 0，无 root Broker 权限。目录分页默认 200 项，文本最多 1 MiB，上传最多 8 MiB、不覆盖同名文件；execute 路由 JSON 上限 12 MiB，反向代理上传限制需单独核对。详见 [文件管理](FILES.md)。

# 服务读取筛选（2026-10-16）

services.list 新增可选 nameKeyword、active、sub 字符串输入，空值表示全部；名称按忽略大小写的字面子串匹配，两个状态精确匹配，条件同时成立。结果新增 activeStates/subStates（本次完整采集中的状态选项），count 是筛选后的记录数。原始 units 输出仍保留完整命令原文。

筛选发生在同一个 Action 的解析结果中，输入不拼接进 Shell。ActionCommands 的 decode 第二参数现包含经过引擎校验的 input，已有仅使用 durations 的模块保持兼容。Web 复用面板 text/select 输入控件，条件改变立即筛选已加载数据，清空恢复全部；刷新数据重新采集。

# 基本信息与 CPU 字段调整（2026-10-16）

system.info 新增 distribution（Linux os-release 的发行版及版本），保留 platform/release/arch/uptimeSeconds/nodeVersion；移除 hostname/cpuCount/totalMemoryBytes/freeMemoryBytes 的采集、命令和结果字段。内核版本独立展示；内存只在资源 Action 展示。

system.resources.cpu 新增 availableParallelism（nproc / os.availableParallelism），命令配置优先当前 resources.availableParallelism，再沿用旧 system.info.cpuCount。logicalCpus 仍是在线逻辑处理器数；两者都不是物理核心数。CPU 圆环显示整机忙碌百分比，下方显示整数计数，不再显示折算小数核数。旧私有配置条目保留但不再执行已删除字段。

手机导航外框和功能/面板选项卡改为直角、左右贴边且无左右边框，保留上下安全边距；展开与收起按钮更紧凑。桌面导航布局保留。

# 系统概览资源重构（2026-10-16）

system.resources 现在返回 cpu、memory、disk，并显示在基本信息前面；system.info 不再返回 disk，也不再执行 filesystem 命令。磁盘输出路径从 system.info.result.disk 改为 system.resources.result.disk；两个 Action ID 保持不变。

磁盘命令配置按 system.resources.filesystem → system.info.filesystem → storage.usage.filesystem → 默认命令的顺序沿用；保存只写当前 resources Action，旧私有条目保留。资源 raw 中包含 filesystem，基本信息 raw 不再包含它。CPU/内存原有命令迁移不变。

面板新增通用 gauge renderer 与 sections.layout:'grid'；CPU 显示整体忙碌比例及逻辑处理器/可用并行度整数信息，内存和磁盘显示已用/总量。模块不附带 CSS/Vue。

# 新增终端与 MCP 参数映射（2026-10-16）

新增 terminal.execute 写能力，以普通服务账户运行，MCP 工具从 Action Schema 自动生成参数并转发；旧无参数工具继续工作。终端模块加载后，此能力对有效可信 MCP grant 自动可用，客户端刷新工具清单；不要求重新逐工具授权。Web PTY 需要 Python 3，安装 xterm 依赖由正常 npm ci 构建完成。详细使用/清理/资源边界见 [TERMINAL.md](TERMINAL.md)。

# 既有升级说明：系统 Action 合并（2026-10-16）

| 旧接口 | 新接口 |
| --- | --- |
| 旧 system.info + storage.usage | 当前 system.info（基本字段）+ system.resources（含 result.disk） |
| system.cpu + system.memory | system.resources，返回 result.cpu/result.memory/result.disk |

仅注册两个系统 Action，不保留旧别名；storage 模块删除。Web 直接按模块展示配置渲染；MCP 客户端刷新 tools/list，改用新 ID。旧 OAuth grant 无需逐工具重新授权。

保存的 system.info 原字段优先保留；filesystem 按上述顺序从旧 system.info/storage.usage 读取；CPU/meminfo 从旧 system.cpu/system.memory 读取。统一保存写入当前 Action，并优先于旧配置。旧私有条目保留，不写公开日志；迁移不执行。升级后在命令页核对自定义值并刷新验证。

新增通用 sections，其他模块的 metrics/progress/table 不受影响。Web raw 按原 key 展示 stdout/stderr/exitCode、底部 JSON 同源；MCP 保持解析后 result 契约。

[状态](PROJECT-STATUS.md) · [模块规范](MODULE-DEVELOPMENT.md)

---

## 既有安装与升级流程

# 更新与回滚 · Git 部署

要求：`/opt/linux-panel/.git` 存在，systemd 的 `linux-panel.service` 是唯一运行实例，`/var/lib/linux-panel` 保存真实账号和 OAuth 数据。**不要使用 `scripts/install.sh` 覆盖已有部署。**

> 如果最初在共享主机上使用了 `--node-bin /opt/node24/bin/node` 安装，
> `/usr/bin/node` 仍可能是旧版本。下面的 `npm` 命令和 `scripts/update.sh`
> 必须明确使用正确运行时，而不是碰运气依赖 root 的默认 PATH。
> 自动 Broker 的实现与安装另见 [UPDATER.md](UPDATER.md)。
>
> **已安装 Broker 的实例禁止混用普通手动更新器**：即使暂时关闭了 Web 更新开关，
> 也不要以 root 执行 `scripts/update.sh` 或手工 `npm ci`。
> 该实例源码目录由独立 `linuxpanel-updater` 账户管理，更新必须走单独的 Broker
> 流程及其可信提交、回滚和健康检查；普通更新脚本会主动拒绝已安装 Broker 的主机。
>
> **跨账户运行前检查**：`npm ci` 会重新生成 `node_modules`。即使编译和测试成功，
> Web 的 `linuxpanel` 账户仍可能无法读取 Fastify 的 `package.json` 并在启动时
> 报 `ERR_INVALID_PACKAGE_CONFIG`。新版首次安装器、普通升级脚本和 Broker 都要
> 检查真正的 Web 账户读取/导入权限。

### 独立 Node24 的更新命令

初次以隔离 Node24 安装、**尚未安装更新 Broker** 的机器，可在确认状态备份与变更窗口后使用：

```bash
sudo env PATH=/opt/node24/bin:$PATH bash /opt/linux-panel/scripts/update.sh
```

此命令**真的执行更新**：停止并重新启动 `linux-panel.service`，期间会中断面板访问；
一旦依赖安装或构建失败仍可能需要**手工回滚**。如果只是想检查版本或更新可用性，
应使用面板只读 Action `panel.update.check`，不要执行这条命令。

## 手动更新

```bash
cd /opt/linux-panel
git status --short
git rev-parse HEAD
df -h /
```

如果工作区不是干净的，先确认自己修改过的文件；不要直接 `git reset --hard`。记录更新前 SHA，备份私有状态：

```bash
sudo systemctl stop linux-panel.service
sudo cp -a /var/lib/linux-panel/panel-state.json \
  /var/lib/linux-panel/panel-state.json.before-upgrade
git fetch origin main
git pull --ff-only origin main
npm ci --no-audit --no-fund
npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock
npm run check && npm test && npm run build:web
# 仅适用于未安装 Broker 的 root-owned 手动安装。
sudo chown -R root:linuxpanel /opt/linux-panel
sudo chmod -R g+rX,g-w,o-w /opt/linux-panel
sudo runuser -u linuxpanel -- test -r /opt/linux-panel/node_modules/fastify/package.json
sudo runuser -u linuxpanel -- test -r /opt/linux-panel/apps/web/dist/index.html
# 重要：确保以下 node 是真实安装给服务使用的 Node 22.12+/24。
sudo runuser -u linuxpanel -- /opt/node24/bin/node --input-type=module \
  -e "await import('fastify'); await import('@fastify/static')"
sudo systemctl start linux-panel.service
sudo systemctl status linux-panel.service --no-pager
```

这是保守的全量升级，每次会有短暂停机。单独更新后端 JS、依赖未变时，可以只执行 `git pull`、测试和服务重启；前端变化则仍要运行 `npm run build:web`。

## 脚本式手动升级（有停机时间）

下面的写法**仅适用于 root 默认 PATH 中的 Node/npm 已满足要求**。如使用独立 `/opt/node24`，必须改用本页顶部的 `sudo env PATH=/opt/node24/bin:$PATH bash …`。

```bash
sudo bash /opt/linux-panel/scripts/update.sh
```

仅支持无本地修改的 `main`，会先保存状态和旧 SHA，使用 fast-forward 更新，然后重新安装依赖、跑测试并构建。失败时需手动回滚，不提供多实例热切换。

## 回滚

若回滚需要旧数据结构，应先停止服务并确认相应私有备份。不要随意用旧状态覆盖新的客户端授权和会话。

```bash
sudo systemctl stop linux-panel.service
cd /opt/linux-panel
git switch --detach <PREVIOUS_FULL_SHA>
npm ci --no-audit --no-fund
npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock
npm run build:web
# 手动回滚同样必须恢复运行账户的依赖读权限。
sudo chown -R root:linuxpanel /opt/linux-panel
sudo chmod -R g+rX,g-w,o-w /opt/linux-panel
sudo runuser -u linuxpanel -- test -r /opt/linux-panel/node_modules/fastify/package.json
sudo systemctl start linux-panel.service
```

故障检查：`journalctl -u linux-panel.service -n 80 --no-pager`。维护完成后可使用 `git switch main` 和 `git pull --ff-only` 重新跟踪主分支。
