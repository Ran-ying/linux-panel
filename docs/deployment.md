# 开发与部署约定

## 工作流

MacBook 本地编程、测试和构建 → 私有 GitHub 仓库 → VPS 部署 → PM2 持久运行。不要在只有 1 GB 内存的 VPS 上进行大规模前端编译。

当前 v0.1 **仅限本地只读原型**，没有账号认证、CSRF 防护、审计或远程 MCP。即便服务监听 `127.0.0.1`，也不应该配置公网反向代理。

## 本地调试

```bash
npm install
npm run dev:api   # 终端 1
npm run dev:web   # 终端 2
```

## PM2（后续内测时）

建议给此项目配置独立的**非 root Linux 用户**。准备好 Node 和 PM2 后：

```bash
npm ci             # 需要首次 npm install 产生并提交 package-lock.json
npm run build:web  # 优先在 MacBook 构建并上传 dist
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs linux-panel
pm2 save
```

首次设置开机恢复使用 `pm2 startup`，**按 PM2 打印的命令操作**，并确保针对运行这个面板的 Linux 账户。当前旧服务器已有 `pm2-root`，不要直接覆盖它或修改现有四个 Node 项目。NVM 更新 Node 版本后，PM2 启动脚本里的路径可能需要同步更新。参考 [PM2 Startup Hook](https://pm2.io/docs/runtime/guide/startup-hook/)。

本地绑定端口：`127.0.0.1:4188`。将来需要远程查看内测界面时，先用 SSH 端口转发：

```bash
ssh -L 4188:127.0.0.1:4188 your-user@your-vps
```

再在 Mac 打开 `http://127.0.0.1:4188`。

## linux.rany.ing 上线前条件

完成 HTTPS、账号和会话、Origin/CSRF 防护、授权、执行审批、持久审计、特权隔离，最后单独进行 MCP 的 OAuth 配置与安全评审。公网发布必须作为独立里程碑。
