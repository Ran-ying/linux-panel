# Linux Panel · 通用安装指南

面向**全新** Ubuntu 24.04 LTS / Debian 12+ VPS。使用 systemd 单实例、非 root 服务账号、Nginx HTTPS 反向代理。CentOS 7 不支持自动安装。

## 先决条件

- 受支持的 Linux、root/sudo、Git、npm、**Node.js 24 LTS**（至少 22.12）。
- DNS A/AAAA 指向 VPS，例如 `panel.example.com`。
- HTTPS 证书，例如 Let's Encrypt（`fullchain.pem` / `privkey.pem`）。
- 至少 1 GiB 磁盘可用空间，推荐 >=1 GiB RAM。
- 80/443 可被访问；不要公开 4188（只监听回环）。
- 已有宝塔/Nginx 站点请采用手动配置，自动脚本拒绝覆盖同名站点。

## A. 完整手动部署

### 1. 基础软件

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx certbot
```

安装 **系统级 Node.js 24 LTS**（不要使用 root 私有的 NVM）。如果发行版不提供 Node 24，可以使用 NodeSource，**先审查下载的安装脚本**：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource-24.sh
less /tmp/nodesource-24.sh
sudo bash /tmp/nodesource-24.sh
sudo apt install -y nodejs
node -v && npm -v && command -v node
```

### 2. HTTPS

**仅在没有其他业务的新服务器上**，可停止尚未配置的 Nginx 并采用 HTTP-01 standalone 验证：

```bash
sudo systemctl stop nginx
sudo certbot certonly --standalone -d panel.example.com \
  --email you@example.com --agree-tos --no-eff-email
```

已有生产网站不可停机，应改用 webroot/DNS 验证、复用已有证书，并自行安排自动续期与 Nginx 证书重载。

### 3. 克隆与构建

```bash
git clone https://github.com/Ran-ying/linux-panel.git
cd linux-panel
npm ci --no-audit --no-fund
npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock
npm run check
npm test
npm run build:web
cd ..
sudo mv linux-panel /opt/linux-panel
sudo chown -R root:root /opt/linux-panel
```

### 4. 非 root 系统账户及管理员初始化

```bash
sudo useradd --system --home-dir /var/lib/linux-panel --shell /usr/sbin/nologin linuxpanel
sudo install -d -o linuxpanel -g linuxpanel -m 0700 /var/lib/linux-panel
sudo install -d -o root -g root -m 0755 /etc/linux-panel
sudo tee /etc/linux-panel/panel.env >/dev/null <<'ENV'
PANEL_PUBLIC_ORIGIN=https://panel.example.com
PANEL_DATA_DIR=/var/lib/linux-panel
ENV
sudo chmod 0600 /etc/linux-panel/panel.env

sudo runuser -u linuxpanel -- env PANEL_DATA_DIR=/var/lib/linux-panel \
  /usr/bin/node /opt/linux-panel/scripts/admin-init.js admin
```

用户名默认为 `admin`。密码在交互终端输入，不写入环境变量或命令历史。此步骤**只能在首次安装执行一次**。

### 5. systemd 与 Nginx

```bash
sudo cp /opt/linux-panel/deployment/systemd/linux-panel.service.example \
  /etc/systemd/system/linux-panel.service
# 如果 node 不在 /usr/bin/node，请手动修改 Unit 的 ExecStart
sudo systemctl daemon-reload
sudo systemctl enable --now linux-panel.service

sudo cp /opt/linux-panel/deployment/nginx/linux-panel-limits.conf \
  /etc/nginx/conf.d/linux-panel-limits.conf
sudo cp /opt/linux-panel/deployment/nginx/linux-panel-proxy.inc \
  /etc/nginx/snippets/linux-panel-proxy.inc
sudo sed -e 's|__DOMAIN__|panel.example.com|g' \
  -e 's|__CERT__|/etc/letsencrypt/live/panel.example.com/fullchain.pem|g' \
  -e 's|__KEY__|/etc/letsencrypt/live/panel.example.com/privkey.pem|g' \
  /opt/linux-panel/deployment/nginx/linux-panel-public.conf.template \
  | sudo tee /etc/nginx/sites-available/linux-panel.conf >/dev/null
sudo ln -s /etc/nginx/sites-available/linux-panel.conf \
  /etc/nginx/sites-enabled/linux-panel.conf
sudo nginx -t && sudo systemctl reload nginx
```

`limit_req_zone` 必须在 Nginx 的 `http {}` 中；Debian 默认 `conf.d` 正是在此作用域包含。如果文件名冲突、证书路径不对或其他站点已有同名域名，**应停止并审查，不能直接覆盖**。

## B. 自动部署脚本（替代 A 中 3–5 步）

先准备好第 1、2 步的工具与证书，再执行：

```bash
git clone https://github.com/Ran-ying/linux-panel.git
cd linux-panel
less scripts/install.sh
sudo bash scripts/install.sh \
  --domain panel.example.com \
  --cert /etc/letsencrypt/live/panel.example.com/fullchain.pem \
  --key /etc/letsencrypt/live/panel.example.com/privkey.pem
```

脚本会重新 clone 一份干净的代码到 `/opt/linux-panel`，安装依赖、测试、构建、创建账号及状态目录、交互初始化管理员、配置 systemd 和 Nginx。**已有 `/opt/linux-panel` 或账号状态时将拒绝安装，不会覆盖现有实例。**

如果由宝塔/Caddy/其他入口提供 HTTPS，选择 `--no-nginx`，再自行设置 Nginx/代理规则：

```bash
sudo bash scripts/install.sh --domain panel.example.com --no-nginx
```

自定义代理要转发所有路径，包括 `/mcp`、`/oauth/*` 与 `/.well-known/*`，同时配置限流、可信真实 IP 和 HTTP/2/SSE 兼容设置。

## C. 验收与 MCP 接入

```bash
systemctl status linux-panel.service --no-pager
ss -ltnp | grep 4188
curl -i https://panel.example.com/api/auth/status
curl -i https://panel.example.com/api/actions
curl -i https://panel.example.com/mcp
```

预期：Web 初始化状态 200；未登录业务 API 401；MCP 默认关闭 404。首次在浏览器登录，确认 CPU/内存/存储值为真实数据。要连接 ChatGPT 等客户端：面板设置里打开 MCP 和允许的只读工具，临时允许 OAuth 新客户端注册，用 `https://panel.example.com/mcp` 连接，完成授权后关闭新客户端注册开关。

如前置 Cloudflare，必须正确配置可信源 IP 列表，不能无条件信任客户端发送的 `X-Forwarded-For`。

## D. 排障

- `npm ci` 失败：检查 Node 24 / 系统库 / 剩余空间。
- Node 仅在 root NVM 下可用：系统账号无法运行，安装系统级 Node。
- `nginx -t` 失败：检查站点冲突、证书和 `conf.d` 限流作用域。
- OAuth 421：确认 Nginx Host 与 `PANEL_PUBLIC_ORIGIN` 完全匹配。
- 登录/授权失败：看 `journalctl -u linux-panel.service -n 80 --no-pager`，但不要公布 Cookie、Token、授权码或密码。
- 失败后不要删除 `/var/lib/linux-panel` 或重新初始化管理员。

后续升级和回滚请阅读 [UPGRADING.md](UPGRADING.md)。

## v0.5 安全与 MCP 更新功能

安装后可按需在 **面板设置 → 账户安全** 启用 TOTP；这不是登录或更新的必需条件。若启用，请离线保存恢复码。默认 MCP 及更新功能都关闭。要使用 AI 申请更新功能，请另外阅读 [UPDATER.md](UPDATER.md)，在管理员审查 root 固定脚本后 **只手动安装一次** systemd 更新 Broker；初次安装脚本不会自动授予 MCP 更新权限。

安装脚本会将代码所有者设为 root，并赋予 `linuxpanel` 组**只读**权限，确保 `umask 027` 不会使系统服务无法读取程序。不会给 Web 进程 Git 或源码写入权限。
