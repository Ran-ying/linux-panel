# Linux Panel · 安装、预检与故障修复指南

> 适用：Linux Panel v0.5 开发版，**首次部署** Ubuntu 24.04 LTS / Debian 12+。同时覆盖全新 VPS 与已运行 Nginx、PM2、TURN 等业务的共享服务器。  
> 推荐优先使用自动脚本；手动安装见第 7 节。**CentOS 7 不支持这套安装脚本和更新 Broker**。尚未通过独立生产安全审计。  
> 本文所有 `panel.example.com`、`panel-test.example.com` 都是**示例域名**，正式安装前必须替换成你自己的、DNS 已配置好的域名。

## 1. 选安装路径与理解边界

| 选择 | 适用情况 | 安装器会操作什么 |
| --- | --- | --- |
| `--preflight --no-nginx` | 第一次摸底，尚无测试域名、证书；或已有自管反向代理 | **只读**，跳过 Nginx/证书检测，不代表 HTTPS 就绪 |
| `--preflight --cert … --key …` | 计划由 Linux Panel 安装器新增一个独立 Nginx 站点 | **只读**，还检测 Nginx、证书、站点和限流区冲突 |
| `install.sh --domain … --no-nginx` | Nginx/Caddy/其他代理自行管理；之后由管理员配置 HTTPS | 克隆到 `/opt/linux-panel`、安装依赖、测试构建、创建账号及 systemd；**不改 Nginx** |
| `install.sh --domain … --cert … --key …` | DNS、证书、Nginx 目录布局已准备好，且允许脚本增加专用站点 | 同上，另安装专用 Nginx 配置并在 `nginx -t` 成功后 reload |
| 第 7 节手动安装 | 自定义目录、特殊服务环境、必须逐步审查每项更改 | 操作由管理员逐项执行，自行承担冲突与回滚检查 |

`install.sh` 是**首次安装器**，不是升级器。已有 `/opt/linux-panel`、`linux-panel.service`、配置或账号状态时会拒绝覆盖；已安装的服务器用 [更新指南](UPGRADING.md)。**不要为通过预检删除真实状态文件。**

本项目初次安装**不会**部署 root 更新 Broker；[自动更新器](UPDATER.md) 是后续单独审查和安装的组件。

## 2. 面板运行要求：脚本检查值与推荐值

| 条件 | 当前脚本强制条件（未满足为 BLOCK） | 实际部署建议 |
| --- | --- | --- |
| 系统 | Ubuntu **24.04+** / Debian **12+**；systemd **>=240** | Ubuntu 24.04 LTS；systemd 服务正常 |
| 权限 | 安装时需要 root / sudo；Git、`runuser` 等基础命令 | 平时通过非 root 的 `linuxpanel` 专用账户运行 |
| Node.js | **Node 24 LTS**，或 **22.12+**；配套 npm | 使用 24 LTS；已有 PM2/Node 的主机使用 `/opt/node24`，**不升级 /usr/bin/node** |
| 端口 | 4188 未被监听 | 应用在回环地址监听 4188；仅经 HTTPS 代理公开 |
| 磁盘 | `/opt` 所在分区至少 **1 GiB 可用** | 尽量预留 **5 GiB+**，尤其在构建、备份和回滚前 |
| 内存 | `MemAvailable + SwapFree >= 768 MiB` | 构建时最好有 **1.5 GiB+ 余量**；共享主机推荐实际 RAM >=2 GiB |
| Nginx | 只有不使用 `--no-nginx` 时检查；版本 **>=1.18**、`nginx -t` 通过、无冲突 | 使用现有受维护的 Nginx；新站点及限流规则不能覆盖其他业务 |
| DNS、证书 | 托管 Nginx 时必须提供可读、绝对路径的证书和私钥 | **正式发布 HTTPS 前**必须有真实域名、正确证书与有效续期机制 |
| 其他 | Bash、Git、npm、标准 Linux 命令；安装可访问可信 Git 仓库 | 出问题时优先停止安装并检查，不要擅自停站、删文件或升级系统组件 |

> **重要**：上表最低阈值是安装脚本当前的**准入门槛**，不是严格的性能基准或生产运行保障。内存门槛把空闲 Swap 计入可用余量，但 Swap 不等于 RAM；在 1 核 / 1 GiB RAM 的 VPS 上执行 npm 构建仍可能很慢、OOM，或影响 TURN 等实时业务。生产环境建议扩容，或者先增加经验证的预构建交付方式（当前安装脚本**没有**该模式）。

## 3. 获取代码并运行只读预检

### 3.1 首次拉取 / 已有仓库更新

~~~bash
# 第一次使用时：
cd /root
git clone https://github.com/Ran-ying/linux-panel.git
cd linux-panel

# 已有 /root/linux-panel 时只执行：
cd /root/linux-panel
git status --short
git pull --ff-only
git rev-parse HEAD
~~~

克隆、拉取本身会写入 `/root/linux-panel`，但**不会**部署服务。先审查脚本，尤其在要以 root 执行安装之前：

~~~bash
less scripts/install.sh
less scripts/install-preflight.sh
less scripts/prepare-host.sh
bash scripts/install.sh --help
bash scripts/prepare-host.sh --help
~~~

### 3.2 没有 HTTPS 证书时，先摸底

~~~bash
sudo bash scripts/install.sh \
  --preflight \
  --domain panel-test.example.com \
  --no-nginx
~~~

此处示例域名仅用于**只读摸底**；`--no-nginx` 跳过 Nginx、证书、域名冲突检查。**不要将示例域名用于真正部署。**

已有独立 Node 24 时加上：

~~~bash
sudo bash scripts/install.sh \
  --preflight \
  --domain panel-test.example.com \
  --no-nginx \
  --node-bin /opt/node24/bin/node
~~~

### 3.3 计划自动配置 Nginx 时，做完整预检

先准备好**真实的域名、DNS 与有效 TLS 证书**，再使用：

~~~bash
sudo bash scripts/install.sh \
  --preflight \
  --domain panel.example.com \
  --cert /etc/letsencrypt/live/panel.example.com/fullchain.pem \
  --key /etc/letsencrypt/live/panel.example.com/privkey.pem \
  --node-bin /opt/node24/bin/node
~~~

如果你使用系统中已符合要求的 Node，可以省略 `--node-bin`。如果尚未取得证书，不要为“通过检测”填入假的证书路径；先完成第 6 节的 HTTPS 准备。

### 3.4 如何阅读输出

| 等级 | 含义 | 是否继续 |
| --- | --- | --- |
| `[PASS ]` | 该项满足脚本检查条件 | 继续查看剩余项 |
| `[WARN ]` | 允许安装，但有风险或后续步骤由管理员负责 | **逐项审查**；可能需要先优化主机 |
| `[BLOCK]` | 阻断条件，脚本以非零状态退出 | **不得安装**；先按第 4 节处理并重新预检 |
| `Preflight summary: 0 blocker(s)` | 所有强制检查都通过 | 可进入**安装决策**，不是已经安装 |

`--preflight` 不会执行 `apt`、`git clone`（安装目录）、`npm ci`、创建用户、启停服务、编辑 Nginx 或写入 `/etc/fstab`。**正式安装时也会重新执行同样的预检**，防止环境在两次命令间发生变化。

## 4. 预检失败怎么办：错误 → 检查 → 修复

| 检测到的信息 | 先检查 | 推荐处理 |
| --- | --- | --- |
| `Node.js 18.x` 或版本低于要求 | `node -v`、`which node`、`pm2 list`（如安装 PM2） | 共享主机优先使用 `bash scripts/prepare-host.sh --install-node` 预览，然后明确执行 `sudo bash scripts/prepare-host.sh --install-node --apply`；重跑预检时加 `--node-bin /opt/node24/bin/node` |
| `npm missing` | `ls -l /opt/node24/bin/npm` | 检查所选 Node 目录是否自带 npm、是否有执行权限；不要把系统 Node 18 的 npm 与独立 Node24 混用 |
| `Only … memory available + … swap` | `free -h`、`swapon --show`、`ps -eo pid,user,comm,rss --sort=-rss \| head` | **优先扩 RAM**；满足文件系统与磁盘条件时可用第 5 节脚本**显式创建** 512–2048 MiB Swap；避免直接停止其他业务 |
| `Only … free on /opt` | `df -h / /opt`、`du -sh /var/log /opt` | 管理员自行找出可清理的非业务文件、扩容磁盘；**不要**盲目删除数据库、日志、备份或现有面板状态 |
| OS / systemd unsupported | `cat /etc/os-release`、`systemctl --version` | 迁移到 Ubuntu 24.04+ / Debian 12+；**不要**移除版本检查或在 CentOS 7 强装 root Broker |
| Missing `git` / `ss` / `runuser` 等 | `command -v git ss runuser` | 审查系统包来源与影响后，通过发行版包管理器手动安装；`ss` 通常由 `iproute2` 提供 |
| Port 4188 already listening | `sudo ss -lntp '( sport = :4188 )'` | 确认哪个服务占用；不要自动杀进程。当前安装脚本没有自定义监听端口选项 |
| Existing panel component / state | `ls -ld /opt/linux-panel /etc/linux-panel /var/lib/linux-panel` | 如果已部署，转 [升级](UPGRADING.md) 或制定备份迁移方案；**不得删除数据来强行重装** |
| Nginx missing / too old | `nginx -v`、`apt-cache policy nginx` | 需要安装器管理 Nginx 时，管理员自行评估并安装受支持版本（脚本最低 1.18）；**不得自动覆盖或升级**运行中的反代 |
| `nginx -t failed` | `sudo nginx -t` | 定位已有 Nginx 配置错误，修复并重新预检；不应跳过验证而强制 reload |
| `server_name` already exists | 审核 `sudo nginx -T` 中的域名配置（输出可能敏感） | 选择新的专用子域名，或用 `--no-nginx` 并审查已有虚拟主机；不自动覆盖 |
| `lp_login` / `lp_oauth_*` limit zone exists | 检查现有 `limit_req_zone` | 使用 `--no-nginx` 走手动集成；不要重复定义相同 zone |
| TLS `--cert/--key` unreadable / missing | `sudo test -r /path/to/cert`，校验域名匹配 | 先完成签发/部署证书；不停止共享 Nginx 抢占 80/443 来签证书 |
| Nginx directories missing | 查看 `/etc/nginx` 目录结构 | Nginx 非 Debian 标准目录布局时使用 `--no-nginx`，自行集成 HTTPS 与限流 |

**排错原则**：只有 `--preflight` 已通过、`WARN` 已审查、真实域名和需要的 TLS 入口已准备好，才进入安装。更换参数（特别是 `--no-nginx`）可能**跳过**一部分检查，不等于解决了原问题。

## 5. 显式环境准备辅助脚本（绝不自动执行）

`scripts/prepare-host.sh` 是独立工具，默认 `DRY-RUN`。`install.sh` **不会调用它**。只有用户明确指定某项准备工作并添加 `--apply` 才实际修改服务器；它不升级系统 Node、Nginx，不停止服务。

### 5.1 查看主机与操作计划（只读）

~~~bash
cd /root/linux-panel
bash scripts/prepare-host.sh --check
bash scripts/prepare-host.sh --install-node
bash scripts/prepare-host.sh --create-swap 1024
~~~

### 5.2 独立安装 Node.js 24

适用于已有 Node 18 / PM2 服务的服务器。脚本支持 Linux x86_64 和 aarch64，当前固定下载 **Node v24.21.0** 官方归档并比对官方 SHA256 清单，仅安装到 `/opt/node24`，若目录已存在则拒绝覆盖。

~~~bash
# 审核计划后，操作员明确批准写入：
sudo bash scripts/prepare-host.sh --install-node --apply

# 验证独立 Node 与 npm
/opt/node24/bin/node -v
PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm -v

# 系统 Node 应继续保持原版本
/usr/bin/node -v
~~~

**不要**为了 Linux Panel 运行 `apt install nodejs`、NodeSource 全局升级或更改已有 PM2 程序的 PATH。正式预检与安装必须都带 `--node-bin /opt/node24/bin/node`。手动安装时 npm 构建应将 `/opt/node24/bin` 放到 PATH 前面。

### 5.3 可选的 Swap（不是强制修复）

可用容量：**512–2048 MiB**。脚本只支持 ext4 / XFS；使用单独的 `/swapfile-linux-panel`，文件权限 0600，要求创建后磁盘至少还剩 **2 GiB**。成功后启用 Swap、把挂载项写入 `/etc/fstab` 并保留一份 `fstab` 备份。

~~~bash
# 先查看方案
bash scripts/prepare-host.sh --create-swap 1024

# 只有决定接受磁盘写入及 I/O 风险后才执行
sudo bash scripts/prepare-host.sh --create-swap 1024 --apply

# 验证，不要重复执行 --apply
swapon --show
free -h
sudo grep -F /swapfile-linux-panel /etc/fstab
~~~

脚本首次成功后**不能反复运行创建同一文件**；它应提示已存在并退出。Swap 交换页可能落盘且影响实时服务延迟。要撤销，需要管理员先核实内存和负载，按系统 Swap 管理流程安全执行 `swapoff` 并编辑 `fstab`；不要直接删除正在启用的交换文件。

### 5.4 重新预检

~~~bash
sudo bash scripts/install.sh \
  --preflight \
  --domain panel-test.example.com \
  --no-nginx \
  --node-bin /opt/node24/bin/node
~~~

检查是否已达到 `0 blocker(s)`，并逐项判断剩余 WARN。若要托管 Nginx，请再用 `--cert / --key` 而**不带** `--no-nginx` 完整预检。

## 6. 从预检成功到正式安装（自动脚本）

**在继续之前：确认已备份共享服务器必要配置；记录当前代码 SHA；检查 4188 端口未占用，空余 RAM、Swap 与磁盘足够；决定使用真实域名、证书和哪种代理模式。**

### 6.1 DNS / HTTPS / Nginx 决策

- **模式 A — 安装器添加专用 Nginx 站点**：选择尚未被现有 `server_name` 使用的真实子域名，配置 DNS A/AAAA；从你的证书提供方或 ACME 流程取得可读 `fullchain.pem` / `privkey.pem`，保证域名匹配。共享 Nginx 已在运行时，**不要停止 Nginx 使用 Certbot standalone**；宜通过已有 webroot、受控 DNS-01 或现有证书管理方式取得证书。Certbot 是否能用 webroot 取决于 80 端口现有虚拟主机是否正确提供 ACME challenge。
- **模式 B — 已有自管代理 / 需复杂配置**：使用 `--no-nginx`，只安装 Linux Panel 服务；**之后仍须手动配置真实 HTTPS、主机头、登录与 OAuth 限流、反向代理到 127.0.0.1:4188**。没有这一步时不应声称面板公网可用。
- **没有域名/证书**：只能进行 `--preflight --no-nginx` 的兼容性摸底；不应使用占位域名实际安装，因为 `PANEL_PUBLIC_ORIGIN` 会固定为它，导致登录/OAuth Origin 不匹配。

### 6.2 模式 A：脚本安装服务与 Nginx

先将例子中的域名与证书路径替换成真实值，确保**不带** `--preflight` 的命令与通过完整预检的参数一致：

~~~bash
cd /root/linux-panel
git status --short
git rev-parse HEAD
sudo bash scripts/install.sh \
  --domain panel.example.com \
  --cert /etc/letsencrypt/live/panel.example.com/fullchain.pem \
  --key /etc/letsencrypt/live/panel.example.com/privkey.pem \
  --node-bin /opt/node24/bin/node
~~~

运行过程会：先强制预检；重新从受信任 Git 远端克隆当前 `main` 到 `/opt/linux-panel`；安装依赖、测试和构建；初始化专用 `linuxpanel` 账户与状态；**交互要求设置管理员密码**；安装并启用 `linux-panel.service`；创建独立 Nginx 站点与限流配置，执行 `nginx -t` 后 reload Nginx。**会写系统目录、启动新服务，并 reload 已有 Nginx**，不是只读命令。

脚本拒绝覆盖已有同名站点和状态；但“发生部分安装失败”与“预检阻断”不同，**不保证所有中间操作自动回滚**，见第 8 节。

### 6.3 模式 B：只安装服务，代理由自己管理

确保域名已经确定（不得仍使用示例域名），可以先运行同参数预检，再正式安装：

~~~bash
sudo bash scripts/install.sh \
  --preflight \
  --domain panel.example.com \
  --no-nginx \
  --node-bin /opt/node24/bin/node

# 预检通过且明确决定正式安装后：
sudo bash scripts/install.sh \
  --domain panel.example.com \
  --no-nginx \
  --node-bin /opt/node24/bin/node
~~~

**仅脚本安装成功并不代表 HTTPS 已配置好**。在现有 Nginx 里，应参考源码模板 [linux-panel-public.conf.template](../deployment/nginx/linux-panel-public.conf.template)、[linux-panel-limits.conf](../deployment/nginx/linux-panel-limits.conf) 和 [linux-panel-proxy.inc](../deployment/nginx/linux-panel-proxy.inc)。所有路径 `/mcp`、`/oauth/*`、`/.well-known/*` 必须按原样转发；需要强制 HTTPS、验证 Host/Origin、登录及 OAuth Token/注册限流，正确处理可信代理 IP，兼容 Streamable HTTP/SSE。将现有配置备份，`nginx -t` 通过后再选择维护窗口 reload；**不要覆盖现有网站**。

### 6.4 当前 Ubuntu 24.04 低资源共享 VPS 实例

以下是 **2026-10-14 实际命令运行结果**（不是生产验收）：

| 阶段 | 观测结果 |
| --- | --- |
| 初始 | Ubuntu 24.04.3、systemd 255、Node 18.19.1、RAM 约 961 MiB、无 Swap、磁盘约 5.1 GiB 可用 |
| 第一次 `--preflight --no-nginx` | **2 BLOCK**：Node 版本过低，约 151 MiB 空闲 RAM + 0 Swap |
| 独立 `prepare-host.sh --install-node --apply` | 安装到 `/opt/node24`，验证返回 Node v24.21.0；系统 Node 18 未被替换 |
| `prepare-host.sh --create-swap 1024 --apply` | 建立并激活 `/swapfile-linux-panel`（1 GiB），已写入 `/etc/fstab`，有备份 |
| 再次 `--preflight --no-nginx --node-bin` | **0 BLOCK / 3 WARN**：约 3.9 GiB 可用磁盘、约 150 MiB 空闲 RAM + 1022 MiB 空闲 Swap、尚未检查/接入 Nginx |
| 当前结论 | **仅依赖预检通过**；未执行正式安装、真实域名配置、Nginx 验收和 Broker E2E |

如果要在这台真实、已有 TURN/RustDesk/PM2/PHP 服务的 VPS 上继续，先建立独立测试域名，确认业务低峰及备份，并优先考虑 RAM 扩容。不要把 3 个 WARN 当作 0 风险。

## 7. 手动部署：要求与步骤

手动安装**并不降低安全或资源要求**。仍需要第 2 节的系统/Node/内存/磁盘/端口条件，真实域名与 HTTPS；手动模式只适合需要精准控制已有业务的管理员。以下命令**会写主机状态**，不得作为预检运行。

### 7.1 系统及工具准备

~~~bash
cat /etc/os-release
systemctl --version | head -1
node -v
npm -v
git --version
nginx -v
sudo nginx -t
free -h
df -h / /opt
sudo ss -lntp '( sport = :4188 )'
~~~

对于**新装、无其他业务**的 Ubuntu，可审查后安装基础软件包：

~~~bash
sudo apt update
sudo apt install ca-certificates curl git nginx certbot
~~~

共享 VPS **不要**不经评估就 `apt upgrade` 或覆盖正在使用的 `nodejs`。如果没有 Node24，优先走 `prepare-host.sh --install-node`；需其他手动渠道时，确保最终 Node >=22.12、npm 配套、二进制路径可供服务账户读取。

### 7.2 手动拉取、安装依赖、测试及前端构建

~~~bash
# 目标位置必须未被使用
sudo test ! -e /opt/linux-panel
sudo git clone https://github.com/Ran-ying/linux-panel.git /opt/linux-panel
cd /opt/linux-panel
git rev-parse HEAD

# 如果使用独立 Node24，全部 npm 子命令使用同一 PATH
sudo env PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm ci --no-audit --no-fund
sudo env PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm install \
  --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock
sudo env PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm run check
sudo env PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm test
sudo env PATH=/opt/node24/bin:$PATH /opt/node24/bin/npm run build:web
~~~

这些命令按当前自动安装器执行内容列出。若使用已符合要求的系统 Node/npm，可相应去掉 `env PATH` 和绝对 npm 路径。不要执行未审查来源的 root 级 npm 脚本。

### 7.3 创建最小权限服务账户、私有数据目录、管理员

先**检查**下列目标目录/文件不存在，**不要覆盖旧安装**：

~~~bash
sudo test ! -e /var/lib/linux-panel/panel-state.json
sudo test ! -e /etc/linux-panel/panel.env
sudo test ! -e /etc/systemd/system/linux-panel.service

# 只在用户不存在时新建
id linuxpanel || sudo useradd --system --home-dir /var/lib/linux-panel \
  --shell /usr/sbin/nologin linuxpanel

sudo install -d -o linuxpanel -g linuxpanel -m 0700 /var/lib/linux-panel
sudo install -d -o root -g root -m 0755 /etc/linux-panel
sudo sh -c 'printf "PANEL_PUBLIC_ORIGIN=https://panel.example.com\nPANEL_DATA_DIR=/var/lib/linux-panel\n" > /etc/linux-panel/panel.env'
sudo chmod 0600 /etc/linux-panel/panel.env

sudo chown -R root:linuxpanel /opt/linux-panel
sudo chmod -R g+rX,g-w,o-w /opt/linux-panel

sudo runuser -u linuxpanel -- env PANEL_DATA_DIR=/var/lib/linux-panel \
  /opt/node24/bin/node /opt/linux-panel/scripts/admin-init.js admin
~~~

将 `panel.example.com` 改为真实域名。最后一条需交互输入管理员密码；无默认密码；**只能对新状态初始化一次**。账号状态不允许公开推送到 GitHub；未来备份时保护 OAuth 授权信息和会话数据。

### 7.4 创建 systemd 服务并验证

以仓库提供的 [linux-panel.service.example](../deployment/systemd/linux-panel.service.example) 为基础；使用独立 Node 时须将 `ExecStart=/usr/bin/node` 改为 `ExecStart=/opt/node24/bin/node`，并保留 `User=linuxpanel`、`ProtectSystem=strict` 与 `ReadWritePaths=/var/lib/linux-panel` 等限制。

~~~bash
sudo sed 's|ExecStart=/usr/bin/node |ExecStart=/opt/node24/bin/node |' \
  /opt/linux-panel/deployment/systemd/linux-panel.service.example \
  | sudo tee /etc/systemd/system/linux-panel.service >/dev/null
sudo chmod 0644 /etc/systemd/system/linux-panel.service
sudo systemctl daemon-reload
sudo systemctl enable --now linux-panel.service
sudo systemctl status linux-panel.service --no-pager
curl -i http://127.0.0.1:4188/api/auth/status
~~~

若服务异常，查看 `sudo journalctl -u linux-panel.service -n 80 --no-pager`；**不要删除数据目录后重新初始化**。

### 7.5 手动 Nginx / HTTPS

手动管理 Nginx 时，同样必须有真实域名、DNS、证书、独立站点和限流。参考第 6.3 节三个模板，审查当前 `nginx -T`，确保没有重复的 `server_name`、`limit_req_zone` 或目标文件；在**备份原配置**后单独新增站点，运行：

~~~bash
sudo nginx -t
sudo systemctl reload nginx
curl -i https://panel.example.com/api/auth/status
~~~

不要使用 `certbot --standalone` 停止已有业务 Nginx；不熟悉现有代理配置时，宁可停在内部 HTTP 验收阶段，暂不公开服务。

## 8. 验收、故障恢复与下一步

### 8.1 安装后检查

~~~bash
sudo systemctl status linux-panel.service --no-pager
sudo journalctl -u linux-panel.service -n 80 --no-pager
sudo ss -ltnp '( sport = :4188 )'

# 安全的本机状态检查
curl -i http://127.0.0.1:4188/api/auth/status

# 完成 Nginx + HTTPS 配置后再检查公网入口：
curl -i https://panel.example.com/api/auth/status
curl -i https://panel.example.com/api/actions
curl -i https://panel.example.com/mcp
~~~

一般预期：认证初始化状态 `200`；未登录的业务 Action API 不应开放（通常 `401`）；默认关闭 MCP 时请求 `/mcp` 应返回 `404`。检查实际状态码和响应内容，不要把 5xx 误认成成功。浏览器登录后确认 CPU、内存、存储读数真实；核对访问日志与 TLS、DNS；需要 MCP 时再按权限最小化原则启用，OAuth 注册窗口不应永久敞开。

### 8.2 安装途中失败怎么办

- **预检阶段** `BLOCK`：`install.sh` 不应做任何安装修改；按第 4 节修复后重跑 `--preflight`。
- **安装已开始**（发生 clone/npm/账号初始化/systemd 阶段失败）：可能留下 `/opt/linux-panel`、`/var/lib/linux-panel` 或 service unit。**不要直接再次运行首次安装脚本**，不要删除已有 `panel-state.json`；检查现场和日志，记录失败步骤，按受控恢复计划处理。
- **Nginx 校验失败**：安装脚本会尝试清理刚创建的代理配置，但面板服务可能已经启动。先看 `sudo nginx -t`、`systemctl status linux-panel.service`，不要随意重置其他站点。
- **资源不足或 OOM**：先检查 `free -h`、`swapon --show`、`df -h` 以及 `journalctl -k`；避免在有实时业务时重复跑 npm 构建。
- **OAuth 421 / 回调异常**：确认 `PANEL_PUBLIC_ORIGIN`、浏览器域名、Nginx Host 与 HTTPS 一致，不要“修复”为放开 Origin 检查。
- **敏感数据**：分享日志时去掉 Cookie、Bearer Token、密码、TOTP 恢复码、OAuth code 和私钥。

**成功启动 v0.5 不等于已启用安全自动更新。** 独立 root Broker 还须阅读 [UPDATER.md](UPDATER.md)，先完成 [更新/回滚验收](UPDATE-ACCEPTANCE.md)；不应直接将未经过故障注入与回滚测试的 Broker 当作生产可用。

其他文档：[升级与回滚](UPGRADING.md) · [安全指南](security.md) · [MCP 接入](mcp.md) · [项目总览](../README.md)。
