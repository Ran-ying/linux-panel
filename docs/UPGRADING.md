# 更新与回滚 · Git 部署

要求：`/opt/linux-panel/.git` 存在，systemd 的 `linux-panel.service` 是唯一运行实例，`/var/lib/linux-panel` 保存真实账号和 OAuth 数据。**不要使用 `scripts/install.sh` 覆盖已有部署。**

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
sudo systemctl start linux-panel.service
sudo systemctl status linux-panel.service --no-pager
```

这是保守的全量升级，每次会有短暂停机。单独更新后端 JS、依赖未变时，可以只执行 `git pull`、测试和服务重启；前端变化则仍要运行 `npm run build:web`。

## 自动升级

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
sudo systemctl start linux-panel.service
```

故障检查：`journalctl -u linux-panel.service -n 80 --no-pager`。维护完成后可使用 `git switch main` 和 `git pull --ff-only` 重新跟踪主分支。
