# 当前升级说明：系统 Action 合并（2026-10-16）

| 旧接口 | 新接口 |
| --- | --- |
| system.info + storage.usage | system.info，新增 result.disk |
| system.cpu + system.memory | system.resources，返回 result.cpu/result.memory |

仅注册两个系统 Action，不保留旧别名；storage 模块删除。Web 直接按模块展示配置渲染；MCP 客户端刷新 tools/list，改用新 ID。旧 OAuth grant 无需逐工具重新授权。

保存的 system.info 原字段优先保留；filesystem 从旧 storage.usage 读取；CPU/meminfo 从旧 system.cpu/system.memory 读取。统一保存写入当前 Action，并优先于旧配置。旧私有条目保留，不写公开日志；迁移不执行。升级后在命令页核对自定义值并刷新验证。

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
