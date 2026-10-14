# Linux Panel v0.5 · 安装与监听配置

**架构原则：Linux Panel 只监听自己的 HTTP TCP 地址/端口，不安装、修改、检查或重载 Nginx、Caddy、Traefik、证书、DNS 或防火墙。** 外部访问方式由管理员决定。本文涵盖预检、BLOCK 修复、自动安装、手动安装、Web Action 改监听与验收。

> 当前仍属开发版本，尚无独立安全审计。安装 Node 依赖、构建及重启服务会影响资源；在现有其他业务的 VPS 上先做备份并选择维护窗口。安装器只支持**首次部署**，不要用来覆盖已有实例。CentOS 7 不支持此安装/更新 Broker 方案。

## 1. 要求和建议

| 检查 | 安装器的最低条件 | 推荐 |
| --- | --- | --- |
| 操作系统 | Ubuntu 24.04+ / Debian 12+、systemd >= 240 | Ubuntu 24.04 LTS |
| Node/npm | Node 24 LTS，或 22.12+；同一安装目录内的 npm | 独立 `/opt/node24`，不替换现有系统 Node/PM2 |
| 主机命令 | Git、systemctl、ss、runuser、install、sed、awk、useradd、df 等 | 官方发行版软件包 |
| 内存 | 可用 RAM + 空闲 Swap >= 768 MiB | >= 1.5 GiB 构建余量；共享主机建议 >= 2 GiB 实际 RAM |
| 磁盘 | `/opt` 可用 >= 1 GiB | 建议 >= 5 GiB 留给构建/备份/回滚 |
| HTTP 监听 | `127.0.0.1` 或 `0.0.0.0`，端口 1024–65535，且端口未被监听 | 默认 `127.0.0.1:4188` |
| 公开 Origin | 本机回环访问自动使用 `http://127.0.0.1:<port>`；公网/代理应明确配置 HTTPS Origin | HTTPS 由管理员独立提供，应用进程仍提供 HTTP |
| Nginx/证书 | **不是安装依赖，脚本不检查、不安装也不配置** | 若选公网访问，使用自管 TLS 反代、可信外部网关或以后支持的直接 TLS 模式 |

**0 BLOCK 只代表满足强制检查**，不是性能评估或生产就绪认证。Swap 不能代替 RAM；公网开放原始 HTTP 会暴露登录凭证，应使用 HTTPS 网关、内网/SSH 隧道与防火墙保护。**当前 Linux Panel 不内置 HTTPS 服务器；绑定 `0.0.0.0` 仅扩大 HTTP 监听面，不自动产生安全的公网 HTTPS 入口。** 如果没有安全的 TLS 终止方案，不要把原始面板端口直接暴露到互联网。

## 2. 获取代码和只读预检

```bash
git clone https://github.com/Ran-ying/linux-panel.git
cd linux-panel

# 只读预检：默认 127.0.0.1:4188，无域名、无 Nginx、无证书要求
sudo bash scripts/install.sh --preflight

# 自定义端口 / 地址：
sudo bash scripts/install.sh --preflight \
  --host 127.0.0.1 --port 4888 \
  --node-bin /opt/node24/bin/node

# 若前面装了旧版本仓库，可以仅更新源码和文档：
git status --short
git pull --ff-only
```

预检打印 `[PASS]`（满足）、`[WARN]`（允许继续但需评估）、`[BLOCK]`（阻断并退出）。
`--preflight` 不安装依赖、不克隆到 `/opt/linux-panel`、不创建账号、不配置 systemd 或代理。正式安装前也会再次运行同一套强制预检。

## 3. 遇到 BLOCK 时如何处理

| 报错 | 检查命令 | 如何修复 |
| --- | --- | --- |
| `Node.js 18.x` / 缺 Node/npm | `node -v`、`which node`、`which npm` | 不改变已有 PM2 运行时。先预览 `bash scripts/prepare-host.sh --install-node`，确认后显式执行 `sudo bash scripts/prepare-host.sh --install-node --apply`；重预检加 `--node-bin /opt/node24/bin/node` |
| `Only … memory available + … swap` | `free -h`、`swapon --show`、`ps -eo pid,user,comm,rss --sort=-rss \| head` | 优先扩容 RAM；磁盘/文件系统允许时可预览 `bash scripts/prepare-host.sh --create-swap 1024`，确认 I/O 风险后明确执行相同命令加 `--apply` |
| `Only … free on /opt` | `df -h / /opt` | 扩容或按管理员确认清理；不要自动删除其他业务数据或备份 |
| OS/systemd too old | `cat /etc/os-release`、`systemctl --version` | 迁移至受支持系统；不可绕过 root Broker 沙箱要求 |
| Missing `git`、`ss` 等 | `command -v git ss runuser` | 审核后由管理员安装对应系统工具（`ss` 通常属于 iproute2） |
| `Port … already listening` | `sudo ss -lntp '( sport = :4888 )'` | 选未占用端口（`--port`），不要自行终止其他业务 |
| Existing `/opt/linux-panel` / service / state | `ls -ld /opt/linux-panel /var/lib/linux-panel` | 使用 [升级流程](UPGRADING.md)，不要删状态强行“重新安装” |
| `0.0.0.0 requires HTTPS --public-origin` | 核对公网域名和 TLS 终止方案 | 在**自管 TLS 网关已经准备好**的前提下明确传 `--public-origin https://panel.example.com`；否则改为 `--host 127.0.0.1` |
| `Invalid --host/--port` | `bash scripts/install.sh --help` | host 当前仅支持 `127.0.0.1` 或 `0.0.0.0`；端口整数 1024–65535 |

**不得为了通过检查运行不明脚本、覆盖已有 Node、停掉 TURN/PM2/Nginx 或删除面板状态。**

### 3.1 仅显式请求才修改主机的准备脚本

```bash
cd /root/linux-panel
bash scripts/prepare-host.sh --check
bash scripts/prepare-host.sh --install-node
bash scripts/prepare-host.sh --create-swap 1024

# 只有管理员决定执行时：
sudo bash scripts/prepare-host.sh --install-node --apply
sudo bash scripts/prepare-host.sh --create-swap 1024 --apply
```

`--apply` 才写主机。独立 Node24 安装到 `/opt/node24`，由官方 HTTPS 下载、SHA256 校验，已存在时拒绝覆盖。Swap 只支持 ext4/XFS、512–2048 MiB、新建 `/swapfile-linux-panel`，启用后写入 `/etc/fstab` 并备份原文件；交换页可能影响实时业务延迟。已完成的步骤不应重复运行。

### 3.2 2026-10-14 Ubuntu 24.04 测试机实例

主机原有 Node 18.19.1，内存约 961 MiB、可用约 150 MiB、无 Swap；首次预检 **2 BLOCK**（Node 与内存）。独立安装 Node v24.21.0，并显式创建 1024 MiB Swap 后：
`--preflight --node-bin /opt/node24/bin/node` 得到 **0 BLOCK、2 个资源 WARN**（约 3963 MiB 空闲磁盘；约 150 MiB 可用 RAM + 1022 MiB 空闲 Swap）。此前第三个 WARN 是旧安装器 `--no-nginx` 的提示，**新版安装器不再检查任何 Nginx 事项**。该机还没有安装 Linux Panel；不应把预检当作运行验收。

## 4. 自动首次安装

### 4.1 本机/反向代理监听（推荐）

默认只在回环地址提供 HTTP。**脚本不配置任何反向代理**：

```bash
cd /root/linux-panel

# 1. 再次只读预检（与你正式安装的参数完全一致）
sudo bash scripts/install.sh --preflight \
  --host 127.0.0.1 --port 4188 \
  --node-bin /opt/node24/bin/node

# 2. 检查 WARN、备份与业务负载，并决定正式安装后：
sudo bash scripts/install.sh \
  --host 127.0.0.1 --port 4188 \
  --node-bin /opt/node24/bin/node
```

如果管理员已配置反向代理，对外地址为 `https://panel.example.com`，在预检与正式安装的命令中都增加：

```bash
--public-origin https://panel.example.com
```

注意：**上面最后一行只是参数示例，必须追加到安装命令，不能单独执行**。`PANEL_PUBLIC_ORIGIN` 是浏览器真实访问源，用于 Host/Origin、Cookie 与 OAuth 验证；**它不是监听地址**。代理必须转发原始 Host、HTTPS scheme 和所有 Web/MCP/OAuth 路径，并负责 TLS 与登录限流。Linux Panel 不会去发现或修改代理配置。 如果是**面板已安装后**才接入域名/HTTPS，请按[第 6 节](#6-已安装面板接入自有反向代理不重新安装)修改并验证 Origin，无需重新运行安装器。

### 4.2 全 IPv4 接口监听（受信任网络或自管入口）

```bash
sudo bash scripts/install.sh --preflight \
  --host 0.0.0.0 --port 4888 \
  --public-origin https://panel.example.com \
  --node-bin /opt/node24/bin/node

# 安全检查通过后，再移除 --preflight 正式安装。
```

这不会开启防火墙规则、申请证书或将 HTTP 变成 HTTPS；必须在网络层限制明文端口的可达范围，并由你的公网 HTTPS 网关转发。**不要将 `0.0.0.0:4888` 的明文 HTTP 直接向互联网开放。**

### 4.3 脚本到底会做什么

通过预检后，安装器克隆受信任的 Git 仓库到 `/opt/linux-panel`、安装和测试 Node 依赖、构建 Vue 前端，创建非 root `linuxpanel` 账户与 `/var/lib/linux-panel` 私有目录，交互设置管理员密码，把监听参数写进 `/etc/linux-panel/panel.env`，安装并启动 `linux-panel.service`。

**不会执行** `apt upgrade`、替换现有 Node、修改 Nginx/Caddy、配置域名、证书或防火墙，也不会自动安装 root 更新 Broker。克隆/构建已开始后的失败可能留下部分文件，不能把它当作可无损重试的事务。每个首次安装仅初始化管理员一次。

### 4.4 首次安装在测试或构建阶段中断：安全续装

如果安装器的预检、首次 Git clone、npm 依赖安装已成功，但在 `npm test` 或
`npm run build:web` 失败，**不能直接再次运行正常的首次安装命令**：
`/opt/linux-panel` 已存在。也不要删除目录、用户状态、服务或者已有 Node 24。

先核实没有走到管理员初始化/systemd 阶段：

```bash
sudo git -C /opt/linux-panel status --short
sudo git -C /opt/linux-panel branch --show-current
sudo git -C /opt/linux-panel remote get-url origin
sudo test ! -e /etc/systemd/system/linux-panel.service && echo 'No service unit'
sudo test ! -e /etc/linux-panel/panel.env && echo 'No panel.env'
sudo test ! -e /var/lib/linux-panel/panel-state.json && echo 'No private state'
```

如果**上面三个 `test` 都为真**，且仓库是干净、root 拥有的
`https://github.com/Ran-ying/linux-panel.git` 的 `main`，可以先把代码更新到
已经修复测试的版本（仅更新**部分安装的面板 checkout**，不会运行任何服务）：

```bash
cd /root/linux-panel
git pull --ff-only
sudo git -C /opt/linux-panel pull --ff-only origin main

# 只读确认 --resume 预检通过
sudo bash /root/linux-panel/scripts/install.sh \
  --resume --preflight --host 127.0.0.1 --port 4188 \
  --node-bin /opt/node24/bin/node

# 审查预检的 WARN 后，显式继续首次安装
sudo bash /root/linux-panel/scripts/install.sh \
  --resume --host 127.0.0.1 --port 4188 \
  --node-bin /opt/node24/bin/node
```

`--resume` 只用于**管理员状态尚未初始化**的第一次安装中断：
会严格检查 Git 目录真实路径、root 所有权、干净工作区、
预期 remote/branch，以及目标 panel.env、私有状态和 systemd unit 均不存在。
随后重跑依赖检查、测试、前端构建，再交互创建管理员并启动服务。
**它不强制 reset、不覆盖现有配置、不重启别的业务。**
如果有任何一个检查不满足，停止操作并单独排障；
不能用 `--resume` 更新已经运行的实例。

本例（Ubuntu 24.04）的一次真实中断：`npm test` 有 68 项，
其中 67 通过、1 项失败，是 `prepare-host.sh --install-node` 的只读测试
错误地假设 `/opt/node24` 不存在；事实上它已被成功安装。
新版脚本已使 dry-run 在节点存在时正常报告现状，
而真正的 `--apply` 仍拒绝覆盖现有 Node。
安装中的 esbuild `install-scripts` 提示只是**警告**，不能据此判断
前端构建已成功；仍必须让 `npm run build:web` 通过。

## 5. 手动安装（同样不依赖 Nginx）

手动安装适合需要严格控制已有业务的运维人员。最低 OS/Node/资源要求与上文相同。

```bash
# 先确认目标尚未存在、端口空闲，且 Node24 已准备好
sudo test ! -e /opt/linux-panel
sudo ss -ltnp '( sport = :4188 )'
sudo git clone https://github.com/Ran-ying/linux-panel.git /opt/linux-panel
cd /opt/linux-panel

# 独立 Node24 的 npm 构建（会消耗 RAM/Swap）
sudo env PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm ci --no-audit --no-fund
sudo env PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm install \
  --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock
sudo env PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm run check
sudo env PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm test
sudo env PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm run build:web

id linuxpanel || sudo useradd --system --home-dir /var/lib/linux-panel \
  --shell /usr/sbin/nologin linuxpanel
sudo install -d -o linuxpanel -g linuxpanel -m 0700 /var/lib/linux-panel
sudo install -d -o root -g root -m 0755 /etc/linux-panel
sudo test ! -e /etc/linux-panel/panel.env
sudo sh -c 'set -C; umask 077; printf "PANEL_LISTEN_HOST=127.0.0.1\nPANEL_LISTEN_PORT=4188\nPANEL_DATA_DIR=/var/lib/linux-panel\n" > /etc/linux-panel/panel.env'
sudo chmod 0600 /etc/linux-panel/panel.env
sudo chown -R root:linuxpanel /opt/linux-panel
sudo chmod -R g+rX,g-w,o-w /opt/linux-panel

sudo runuser -u linuxpanel -- env PANEL_DATA_DIR=/var/lib/linux-panel \
  /opt/node24/bin/node /opt/linux-panel/scripts/admin-init.js admin

sudo test ! -e /etc/systemd/system/linux-panel.service
sudo sed 's|ExecStart=/usr/bin/node |ExecStart=/opt/node24/bin/node |' \
  /opt/linux-panel/deployment/systemd/linux-panel.service.example \
  | sudo tee /etc/systemd/system/linux-panel.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now linux-panel.service
```

可按需在 `panel.env` 中设置 `PANEL_PUBLIC_ORIGIN=https://真实域名`，但这只是**应用安全校验所用的 Origin**，不负责实现 HTTPS。没有代理时，建议本机/SSH 隧道访问；对外访问由操作者自行管理。

## 6. 已安装面板接入自有反向代理（不重新安装）

本节专门针对**已经完成首次安装、后续才配置自有域名或 HTTPS 入口**的情况。不要再次运行 `install.sh`，也不需要修改面板的监听地址或开放 `4188` 端口。Linux Panel 只提供 HTTP 服务，反向代理和 TLS 由管理员自行配置，可使用 Nginx、Caddy、Traefik 或其他网关；**面板安装器不会发现、安装、修改、测试或重载这些代理**。

### 6.1 先准备好用户自己的 HTTPS 入口

以下所有域名均为**通用占位符**，不是任何使用者的实际部署信息：

- 公网浏览器访问源（Origin）：`https://panel.example.com`。
- 面板后端：`http://127.0.0.1:4188`（保持默认回环监听）。
- 代理须转发根路径、`/api/*`、`/oauth/*`、`/.well-known/*` 和 `/mcp`；保留浏览器请求中的原始 `Host`，并正确传递外层 HTTPS 信息。
- 代理或网关负责有效证书、HTTPS、限流和公网暴露面控制；不能把原始明文 HTTP 端口直接暴露到互联网。若使用 CDN，真实客户 IP 的信任边界也由代理管理员单独配置，切勿无条件信任客户端传来的 `X-Forwarded-For`。

在代理侧完成配置检查与证书验收后，再修改 Linux Panel 的 Origin。具体 Nginx/Certbot/Cloudflare 命令均属于使用者自己的运维，不是本项目的安装步骤或依赖。

### 6.2 更新已安装实例的公开 Origin

**Origin 用于校验浏览器 `Host`、请求 `Origin` 以及 Cookie/OAuth 安全策略，不是 HTTP 监听地址。** 必须填写浏览器实际打开的 HTTPS Origin，格式为 `https://panel.example.com`；如果浏览器使用非默认端口，还应包含端口。不要添加末尾斜杠、URL 路径或多条重复定义。

```bash
# 1. 先确认 Linux Panel 仍在本机端口运行
sudo systemctl is-active linux-panel.service
sudo ss -lntp '( sport = :4188 )'

# 2. 仅备份 Linux Panel 自己的配置文件（不要编辑源代码）
sudo cp -a -- /etc/linux-panel/panel.env \
  "/etc/linux-panel/panel.env.backup.$(date +%Y%m%d-%H%M%S)"

# 3. 用管理员编辑器修改，确保只有一条 PANEL_PUBLIC_ORIGIN 定义
sudoedit /etc/linux-panel/panel.env
```

在 `/etc/linux-panel/panel.env` 中设置：

```ini
PANEL_PUBLIC_ORIGIN=https://panel.example.com
```

只需修改此变量；**保留** `PANEL_LISTEN_HOST=127.0.0.1`、`PANEL_LISTEN_PORT=4188` 和 `PANEL_DATA_DIR` 原有值。保存后检查 Origin 是否恰好一条（不要输出文件中的其他潜在敏感配置）：

```bash
sudo grep -n '^PANEL_PUBLIC_ORIGIN=' /etc/linux-panel/panel.env

# 4. 显式重启 Linux Panel，读取更新后的 systemd EnvironmentFile
sudo systemctl restart linux-panel.service
sudo systemctl is-active linux-panel.service
```

这次重启**只影响 Linux Panel**，不会重启 Nginx 或其他服务。若已启用 MCP/OAuth，短暂重启会中断进行中的请求，请选择合适的维护窗口。

### 6.3 验证 Host、HTTPS 和浏览器登录

```bash
# 本机检查：生产环境会严格校验 Host，不能省略这个头
curl -i -H 'Host: panel.example.com' \
  http://127.0.0.1:4188/api/auth/status

# 外部 HTTPS 入口：应返回 HTTP 200 和初始化状态 JSON
curl -i https://panel.example.com/api/auth/status

# 检查服务日志（遇到故障时）
sudo journalctl -u linux-panel.service -n 80 --no-pager
```

随后在浏览器打开 `https://panel.example.com`，实际验证登录、退出，以及按需启用的 OAuth/MCP 回调。`/api/auth/status` 的 HTTP 200 只证明基础路由可达，**不能证明登录、权限或 OAuth 全链路已通过**。

典型故障判断：

| 现象 | 重点检查 |
| --- | --- |
| `403 Origin not allowed` | `PANEL_PUBLIC_ORIGIN` 是否等于浏览器地址栏的实际 scheme、主机和端口；是否意外重复定义；是否已重启面板 |
| `421 Unrecognized public host` | 自有代理是否保留了浏览器 `Host`，且它与 Origin 的主机和端口完全一致；本机 `curl` 是否忘记 `-H 'Host: …'` |
| HTTPS/证书错误，CDN 526 | 检查用户侧网关到源站的证书链与 TLS 模式；这不是通过改面板监听地址解决的问题 |
| CDN 522/连接失败、502/504 | 检查 DNS、源站防火墙、代理 upstream 是否指向正确回环端口，及 `linux-panel.service` 状态 |
| OAuth/MCP 连接失败 | 确认代理没有遗漏 `/oauth/*`、`/.well-known/*`、`/mcp`；并核查授权和 MCP 策略是否单独开启 |

**回退**：如果 Origin 配错导致无法登录，可以在 VPS 本地编辑 `/etc/linux-panel/panel.env` 恢复上一个正确值（或从步骤 2 的备份恢复），然后只重启 `linux-panel.service`。不要清空 `/var/lib/linux-panel`、覆盖管理员状态、删除证书或重装整个面板。

---

## 7. Web 面板中的监听 Action

- `panel.listener.status`：只读查看**当前运行**与**已保存（下次启动）**的监听地址/端口和待确认申请。仅 Web 暴露，MCP 不提供更改接口。
- `panel.listener.request`：提交主机地址+端口变更申请，15 分钟内由同一登录管理员在 Web 重新输入密码确认；启用 TOTP 的账户还需新验证码。
- `POST /api/panel/listener/approve` / `.../cancel`：受 Web Session、Origin 和 CSRF 保护；批准后仅把监听设置存入独立权限保护的面板状态，返回 `restart_required`，**不会自动重启服务**。

示例：在 Web“面板维护 → HTTP 监听设置”填写 `127.0.0.1:4888`，申请、确认密码，准备好代理/SSH 隧道及防火墙后，管理员在维护窗口**明确执行**：

```bash
sudo systemctl restart linux-panel.service
sudo systemctl status linux-panel.service --no-pager
sudo ss -lntp '( sport = :4888 )'
curl -i http://127.0.0.1:4888/api/auth/status
```

**服务重启后改用新端口访问**。如无法启动，不要删 `/var/lib/linux-panel`；用 `journalctl -u linux-panel.service -n 80` 分析，并核对保存的监听设置/端口冲突。未来若增加在线“应用配置”动作，必须先设计可回滚的独立服务重启机制，避免锁死管理入口。

## 9. 安装后可选：受限更新 Broker

受限更新 Broker **不是 Linux Panel 的基础安装依赖**；它用于在授权后按
固定规则更新面板本身，与 Nginx、证书、域名完全无关。Broker 有独立的
管理员脚本，不能在未验收时由普通 Web 或 MCP 自动安装 root 服务。

首次安装成功并初始化管理员后，在支持的 Ubuntu 24.04+/Debian 12+
上按顺序执行：

```bash
cd /opt/linux-panel
sudo bash scripts/install-update-broker.sh --check
# 无 BLOCK、审阅 WARN，并备份 VPS/面板状态后，再明确安装：
sudo bash scripts/install-update-broker.sh --apply
sudo bash scripts/install-update-broker.sh --verify
```

`--check` 和 `--verify` 只读；`--apply` 创建独立更新用户、固定执行器、
Git 来源校验文件及 systemd 单元，但**暂不启用 Web 更新开关或 path watcher**，
也不执行更新。它会修改 `/opt/linux-panel` 的权限与所有者，因此只能由管理员
在维护窗口执行。

更新 Broker 必须先在隔离测试机完成
[更新/回滚验收](UPDATE-ACCEPTANCE.md)，并核对 systemd 的实际沙箱属性。
完成后才能显式启用：

```bash
sudo bash /opt/linux-panel/scripts/install-update-broker.sh \
  --activate --ack-acceptance
```

启用会重启 **Linux Panel 自身**，不触及反向代理。MCP 申请更新还需独立的
OAuth 授权和更新策略；默认只读。详细流程、BLOCK 含义及私有仓库密钥隔离见
[Broker 安装与更新指南](UPDATER.md)。旧版 CentOS 7 不受支持。

## 8. 验收及以后更新

```bash
sudo systemctl status linux-panel.service --no-pager
sudo ss -lntp '( sport = :4188 )'
curl -i http://127.0.0.1:4188/api/auth/status
```

认证初始化状态通常为 200；未登录业务 API 应拒绝（通常 401）；MCP 默认关闭（通常 404）。如果启用了自己的 HTTPS 入口，再测试 `https://真实域名/api/auth/status`、登录、OAuth、MCP 和真实的 CPU/内存读数。

**当前更新 Broker 未完成真实环境的故障注入与回滚验收**。安装面板不等于允许 AI 自动更新。参见 [UPDATER.md](UPDATER.md)、[UPDATE-ACCEPTANCE.md](UPDATE-ACCEPTANCE.md) 和 [UPGRADING.md](UPGRADING.md)。

如安装被 BLOCK，请修复后重新预检；如在 npm/build/账号初始化/systemd 步骤中失败，可能存在部分安装，**不要直接删除状态后重装**。共享主机需在业务低峰维护并记录原 Git SHA 和服务配置；日志中不要分享密码、Cookie、Token、OAuth 授权码、TOTP 恢复码或私钥。
