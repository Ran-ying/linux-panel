# 定时任务（Cron）

首版管理专用 `/etc/cron.d/linux-panel`，不读取或覆盖用户已有 crontab、其他 `/etc/cron.d` 文件或 systemd timers。Linux Panel 进程仍为 `linuxpanel`；根端仅管理固定配置文件，每条 Cron 规则都有静态运行身份 `linuxpanel`，**不允许运行 root Cron 命令**。Cron 是持续执行命令的能力，使用者须是可信管理员；`linuxpanel` 账户的终端、PTY 和自定义采集命令也拥有相同信任边界。

## 可用功能

Web 模块列出面板托管任务，提供创建、编辑、启停和删除，以及五字段数字 Cron 表达式。接受 `*`、`*/5`、`1,3`、`1-5/2` 等，拒绝跨行、无效区间和特殊 `@reboot` 宏。表达式按服务器本地时区及 Cron 的标准日/星期语义解释；不计算预测下次运行时间。命令由 Cron 的 /bin/sh 执行，Cron 对未转义百分号有特殊含义；用户需自行按 Cron 语法转义。仅当系统已安装、启用并正常运行 cron daemon 时任务才会执行，本模块本身不启动 cron 服务。

每个任务存储在两行中：不可执行元数据和实际 cron 条目（或停用注释行）。读取时严格检查整个文件是否属于本模块；不认识或被外部修改的内容拒绝覆盖。Web 读到 `revision` SHA256，所有写操作都必须携带该值；冲突返回 HTTP 409 并提示刷新。写操作由独立 root 服务串行执行，临时文件以 root 拥有且 mode 0644 后在同目录替换。最多 100 个任务、每条命令最多 500 字符。不会删除未知任务，也不尝试直接执行用户命令。

## 安装与权限

此模块需要已经启用的通用 root 执行器及**包含 Cron handler 的最新固定 root-owned 安装包**。更新普通 Web/main 源码不会将新 handler 自动安装到 root 包。管理员应先确认操作系统有 `/etc/cron.d`、`cron.service`（Ubuntu/Debian），再显式运行：

```bash
sudo bash /opt/linux-panel/scripts/install-privileged-executor.sh --enable
```

启用前或旧版 root 安装包尚无对应 handler 时，模块只会显示错误而不会降级为普通用户写 crontab，也不会提供绕过沙箱的 root Shell。已有 root 文件 Actions 保持独立。Web 接口需登录/CSRF/Origin；Cron Actions **不暴露给 MCP**，同一 UID 下的受信任终端可直接访问受控 root socket，不能视为 OS 级隔离。

## 已知限制

不展示其他用户/系统 Crontab、systemd timers、不记录执行历史，也不解析系统日志。任务是配置，保存成功不表示 cron daemon 已实际触发。修改现有生产任务前应另行确认执行目标。停用仅注释对应行，不终止正在运行的进程。当前不提供秒级调度、任务依赖、超时或运行结果回传。
