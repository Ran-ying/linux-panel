# 定时任务

Linux Panel 侧边栏**只有一个「定时任务」模块**。进入后有两个独立的页签：

1. **Linux Panel 托管的定时任务**：仅列出面板在 `/etc/cron.d/linux-panel` 中创建的任务，支持新建、编辑、启停和删除。
2. **系统现有定时任务**：列出系统已有 Cron、各用户 crontab、周期脚本和 systemd timers，并按来源、执行用户和状态筛选；支持按任务类型受控管理。

切换这两个页签只更换前端显示内容，不创建第二个侧边栏模块、不刷新后台数据，也不改动已有定时任务。

## 来源与支持范围

| 来源 | 显示 | 修改 |
| --- | --- | --- |
| `/etc/crontab` | 是：标准五字段、宏、执行用户、完整来源 | 标准五字段逐项编辑/启用/停用/删除 |
| `/etc/cron.d/*`（排除专用 `linux-panel`） | 是 | 标准五字段逐项编辑/启用/停用/删除 |
| `/var/spool/cron/crontabs/*`（各用户的 crontab） | 是 | 标准五字段逐项编辑/启用/停用/删除，通过正式 `crontab -u` 安装，绝不直接写 spool |
| `/etc/cron.hourly,daily,weekly,monthly` | 是：实际周期脚本及可执行状态 | 只读；修改请用文件管理 |
| 系统范围 `*.timer` | 是：运行状态、对应服务、下次执行时间 | 能启停的 timer 通过固定 `systemctl enable/disable --now` 操作；静态/特殊 timer 只读 |
| `/etc/anacrontab` | 是：Anacron 任务 | 只读；使用系统配置编辑 |
| `atq`（若已安装） | 是：单次计划任务 | 可确认删除单条任务（固定 `atrm`），不提供批量操作 |
| Linux Panel 自有 `/etc/cron.d/linux-panel` | 是：单独分组 | 新建、编辑、启停、删除，执行用户固定 `linuxpanel` |

此范围不声称涵盖所有第三方计划任务系统或每个用户独立 session 的 systemd --user timer；不计算不存在的下次执行时间。面板只管理已识别的条目；复杂宏规则、包维护的周期脚本、静态 timer 为只读。避免混淆系统已有任务与 Linux Panel 自己创建的任务。

## 权限与安全边界

所有读取和写入都调用已审核的固定 root handler，通过现有 ActionEngine/PrivilegedActionClient 以及登录、CSRF/Origin 保护；不提供 root Shell、任意路径或 systemctl 单元输入。UI 清楚显示来源、执行用户并确认系统任务修改可能影响 OS 更新/证书续期等工作。仍属于个人管理员具备 root 文件管理能力的信任模型，不适用于不可信多用户。

修改已有标准 Cron 条目时：以整个来源文件的 SHA-256 revision 和原始行匹配为前提，**只改变精确匹配的一行**；保留无关环境设置、注释、其他任务及原文件所有者/权限；修改配置采用同目录临时文件原子重命名；竞争修改则拒绝。用户 crontab 通过 crontab CLI 安装，避免直接写入 spool。面板自己创建的任务仍独立保存，使用严格元数据与 revision。

普通管理操作不终止已运行中的进程，不代表周期任务实际执行成功。对于系统提供的 timer 停用，应理解可能同时影响系统维护计划。Cron 表达式使用服务器本地时区；Cron 百分号和跨日、星期字段语义仍遵循操作系统 Cron 实现。

## 部署

本模块依赖 Linux Panel 已安装的新版**版本化受控 root 包**。新的已审核 root 文件通过 `platform/privileged/package-manifest.json` 打包；若系统已完成一次性的 root Broker 迁移，后续经过授权的 main 更新会自动部署。仅前端源码更新不代表新系统读取/修改 handler 已生效；必须验证 root socket 的新 Action 与 Web 响应，不能把任务统计为零当成全系统为空。

正式目标 VPS 上的验收以只读系统清单为先；Cron/Timer 写入的行为应首先在一次性 CI 虚拟机用无害任务与专门测试账户验收，不应为实验停用生产环境的系统维护定时器。
