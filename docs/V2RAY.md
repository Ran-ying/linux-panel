# V2Ray 本机管理

## 实际目标环境（2026-10-17，只读检测）

- VPS：Ubuntu 24.04.3 / amd64，V2Fly **V2Ray 5.47.0**。
- Binary: /usr/local/bin/v2ray，systemd: v2ray.service（active、enabled）。
- 主配置：/usr/local/etc/v2ray/config.json，root-owned；支持 V2Ray 5.x 常见字段和保留旧的 inboundDetour/outboundDetour。
- 读取主配置时不向 Issues、测试日志或仓库输出真实地址、UUID、密码和私钥。
- Ubuntu 24.04 apt 的候选版本为 4.34.0，因此安装入口不使用 apt 的旧版本。

## 模块功能

- 状态摘要：内核版本、二进制路径、服务运行及自启状态、入站/出站数量、已配置的功能字段。
- 认证 Web 的完整 JSON 和分项 JSON 编辑：入站、出站、路由、DNS、传输、日志、策略、API、统计、反向代理、监测及旧字段。**不丢弃未知字段**，不自动从 V2Ray 转换到 Xray。
- 配置检测：使用当前 V2Ray 内核的 test -c 命令对候选临时文件检查，不切换工作配置。
- 保存：SHA-256 revision 防覆盖、严格 JSON、原子替换并保留权限；失败拒绝修改。对正在运行的服务尝试重启；重启失败则恢复之前的配置并尝试重新启动旧服务。原本停止的服务不自动启动。
- 系统服务：启动、停止、重启、设置/取消开机自启，Web 有确认弹窗。
- **未安装入口**：仅 Linux amd64、无程序/同名配置/service 时显示安装；固定官方 V2Fly v5.47.0 release ZIP（sha256 56215328ad7a65e387e772af22232ac6531c34a1bb2252a64599a3a41aa7de5c），仅提取 v2ray、geoip.dat 和 geosite.dat；创建服务及默认仅监听 127.0.0.1:10808 的 SOCKS 配置。**不自动下载或覆盖现有安装。**

## 权限与限制

- 对应 v2ray.status/read/test/save/service/install 六个 Action，其中仅不含敏感信息的 status 允许 MCP；读取认证配置仅在 Web 管理员认证/CSRF 后通过独立 root Handler 执行。
- 仅作用于固定官方布局 /usr/local/etc/v2ray/config.json（后备 Ubuntu 发行版布局 /etc/v2ray/config.json）和固定 v2ray.service；不接受任意文件路径、任意命令、安装 URL 或服务名。
- 独立 root Handler 通过 package-manifest 固定部署；已完成一次性受控 root 包自动更新迁移的服务器，普通签名主分支更新会同步源码；未启用 root 执行器的首次安装需要按 PRIVILEGED.md 激活。
- 不修改正在运行的实际 VPS 配置、流量路由、证书或端口。安装只在管理员点击并确认后执行，且需要 GitHub 网络、unzip、systemctl 与 root。
- API/stats/transport 字段可通过 JSON 编辑，但首版**未实现** V2Ray gRPC API 的运行时用户增删、流量统计实时查询、连接详情、订阅转换、自动版本升级、多实例或非标准 confdir 接管。
- 编辑配置时可能使代理断联；保存前有内核检查及失败恢复，但不能保证跨外部网络或上游服务的连通性。敏感配置不得记录在日志。
- 用户自行配置开放公网监听、TLS 等；默认安装仅建立回环入站，避免无意开放代理。

## 维护方式

- 根操作代码：platform/privileged/v2ray-contracts.js、v2ray-operations.js，固定注册于 handlers.js 及 package-manifest.json。
- 业务模块：modules/v2ray/manifest.json、index.js、ui/presentations.js。
- 面板通用 renderer：V2RayManager.vue，通过 ActionCard 和严格 presentation descriptor 连接。
- 自动测试：tests/v2ray.test.js 使用临时目录、模拟服务运行器验证保留旧字段、配置版本冲突、校验拒绝及重启失败回滚；浏览器测试覆盖不同视口、未安装入口和编辑操作。
- 不在真实 VPS 上执行测试安装或触碰真实 V2Ray 用户配置。
