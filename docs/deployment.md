# Linux Panel v0.3 · 私人公网预览部署指南

> 目标：在一个**受支持且定期打补丁**的 Linux 主机上，让 Fastify 只监听
> `127.0.0.1:4188`，由已配置有效 HTTPS 的 Nginx 反代。
> 这属于**私人受控预览**，不是经独立审计的生产安全认证。
> 这里所有 Linux/Nginx 命令都需要由你手动在服务器上执行；不要覆盖现有站点配置。

## 1. 部署前检查

- 目标服务器使用受支持、可以持续安全更新的 Linux 系统。**不要直接将旧 CentOS 7 作为公网管理面板宿主**；它已结束支持，常见 Node.js 22/24 预编译版本也不兼容其旧 glibc。
- 安装 Node.js **22.12+ 或 24**，检查 `node -v`、`npm -v`。确认 `nginx -v`、HTTPS 证书可用。
- 预先备份现有服务器的 Nginx 配置，明确现有反代业务和监听端口，避免覆盖宝塔及其他生产站点。
- 尽量选择独立测试 VPS 或测试虚拟机。正式启用前配置好系统防火墙、SSH 运维入口和更新策略。
- DNS 的 `linux.example.com` 在以下例子中仅为占位符；替换成你实际控制的域名。

## 2. 代码、权限与构建

本示例约定代码在 `/opt/linux-panel`，数据在 `/var/lib/linux-panel`：

```sh
node -v
npm -v
# 从你的私有仓库安全部署代码到 /opt/linux-panel
cd /opt/linux-panel
git switch main
git pull --ff-only origin main
npm ci
npm test
npm run check
npm run build:web
```

生产运行账号单独设为 `linuxpanel`，**不要以 root 运行应用**。在 Ubuntu/Debian 上可以参考：

```sh
sudo useradd --system --home-dir /var/lib/linux-panel --shell /usr/sbin/nologin linuxpanel
sudo install -d -o linuxpanel -g linuxpanel -m 0700 /var/lib/linux-panel
sudo install -d -o root -g root -m 0755 /etc/linux-panel
```

如果系统账号已存在，就跳过 `useradd`；先核对而不是覆盖已有用户。代码目录应允许 `linuxpanel` 读取，但不能允许其修改代码或部署证书。状态目录应只有运行账号能访问。避免将登录数据放入仓库、静态目录或容器公开镜像。

先在 SSH 交互式终端为运行账号创建管理员（**不用把密码写入命令行或环境变量**）：

```sh
sudo -u linuxpanel env PANEL_DATA_DIR=/var/lib/linux-panel \
  /usr/bin/npm --prefix /opt/linux-panel run admin:init
```

若 `npm` 不在 `/usr/bin/npm`，请使用 `command -v npm` 查到的系统级 npm 路径，并确认运行账号能访问。初始密码至少 12 UTF-8 字节；请为面板设置独立的高强度密码。此命令只在首次初始化时运行。

## 3. 生产进程

参考仓库 `deployment/systemd/linux-panel.service.example`。检查路径、运行账号与沙箱限制，确认符合目标系统后才复制为 `/etc/systemd/system/linux-panel.service`。

参考 `deployment/panel.env.example`，安装为 `/etc/linux-panel/panel.env`，内容类似：

```ini
PANEL_PUBLIC_ORIGIN=https://linux.example.com
PANEL_DATA_DIR=/var/lib/linux-panel
```

将配置文件权限设为 `0600 root:root`。systemd 模板已经提供 `NODE_ENV=production`、`PORT=4188`，并设置单实例、非 root、最小化文件系统写入权限。

完成配置后：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now linux-panel
sudo systemctl status linux-panel --no-pager
sudo ss -ltnp | grep 4188
```

**验证只监听 `127.0.0.1:4188`，没有监听 `0.0.0.0:4188`。**
本项目也提供 PM2 配置，但正式测试部署更推荐上述 systemd 单实例模板；不要同时使用 systemd 和 PM2 启动两个进程，它们不支持同时写同一份 JSON 状态文件。

## 4. Nginx / HTTPS

仓库中的 `deployment/nginx/linux-panel.conf.example` 是一个可审查的**示例配置**，不是自动安装脚本：

1. 在 Nginx `http` 作用域添加 `limit_req_zone`；已有配置如果存在同名 zone，则先检查冲突。
2. 将示例中的 `linux.example.com` 和证书路径替换为真实域名、证书。
3. 为面板创建**单独的虚拟主机**；不要覆盖正在使用的 Nginx 主站点。
4. 检查 `proxy_pass http://127.0.0.1:4188`、`Host $host`、`X-Forwarded-Proto https`。
5. 必须使用 `X-Forwarded-For $remote_addr` **覆盖**客户端提供的同名请求头，不能使用无条件 `$proxy_add_x_forwarded_for`。
6. 使用 Nginx `limit_req` 限制 `/api/auth/login` 的公网请求频率。
7. 若 Nginx 前还有 Cloudflare/CDN，先按官方公布且定期更新的代理 IP 范围正确配置 `real_ip`，否则 `$remote_addr` 可能是 CDN 节点而非真实用户。**不要直接相信互联网传入的 `CF-Connecting-IP` / `X-Forwarded-For`。**

```sh
sudo nginx -t
# 只在检查成功且确认没有覆盖其他站点后执行
sudo systemctl reload nginx
```

不要把 Vite 的 5173 端口代理到公网，也不要开放 4188 的公网防火墙规则。Vite 只用于本地开发。

## 5. 预览验收

在**其他设备或公网网络**访问 `https://linux.example.com/`，浏览器必须显示有效 HTTPS 证书和 Linux Panel 登录页。可以做以下无密码检查：

```sh
curl -i https://linux.example.com/api/auth/status
curl -i https://linux.example.com/api/modules
curl -i https://linux.example.com/api/actions
curl -i https://linux.example.com/api/health
```

预期：`/api/auth/status` 返回 200（只暴露是否初始化）；其余未登录 API 返回 **401**。从浏览器正确登录后，系统概览和内置设置均能读取；注销后旧会话无法再次访问，修改密码应撤销其他会话。

继续检查 `Content-Security-Policy`、`Strict-Transport-Security`、Cookie 的 `HttpOnly`/`Secure`/`SameSite=Strict`，和未经授权的 POST 是否会返回 401/403。Nginx 速率限制应该对不同公网客户端分别计数，而非所有用户共享一个代理 IP。

仅查看错误状态和汇总信息；**不要把浏览器 Cookie、CSRF、密码或完整请求头贴到聊天或公开 Issue**。若测试出安全异常，立即关闭面板虚拟主机的公网入口，然后回退部署。

## 6. 备份、回滚与限制

- 私有状态文件默认 `/var/lib/linux-panel/panel-state.json`，其所属账号和权限应保持正确。备份时暂停服务，以免在更新过程中读到不一致状态。备份文件也必须是私有的。
- 代码回滚必须保留相匹配的状态文件备份；新旧数据结构不一定永远兼容，切勿直接删除 JSON 重建管理员当作恢复方法。
- 由于使用单进程 JSON 状态存储，不支持多实例、跨主机共享写入或并发重启服务。
- 若应用日志、网络访问、TLS 或代理限流异常，先禁用面板 Nginx 虚拟主机并 `sudo systemctl stop linux-panel`，不要影响正在运行的其他站点。
- 不允许把旧 CentOS 7、过期 TLS 证书、root 运行或绕过 Origin/CSRF 当作部署捷径。正式面对多用户或敏感业务前需要独立安全审计、持久限流、2FA、容灾演练等。

## 7. 后续

v0.4 才实现 OAuth 和 MCP 可选扩展。v0.3 私人预览只提供带安全会话的 Web 登录和已存在的只读业务 Action。
