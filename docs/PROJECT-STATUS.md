# Linux Panel 当前状态

更新：2026-10-16。v0.5.0 已发布，main 持续迭代。root 执行层已由 PR #112 合并进 main 697ff4698607008aa672c7db1164a39b9c4242b5，本轮补齐首次安装可选启用入口，关联 [Issue #111](https://github.com/Ran-ying/linux-panel/issues/111)。准确 CI、合并、普通 Web 部署与 root 激活证据统一见 [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54)。

## 当前实现

- 通用 [root 执行层](PRIVILEGED.md)：PrivilegedActionClient、独立 Unix socket 服务、固定 root-owned handlers 与独立 Schema 验证。Web 仍普通账户，更新 Broker 保持独立；新 handler 需操作员安装，不动态加载模块目录。
- [文件管理](FILES.md)九个 Action：列表/文本读写/上传/新建/重命名/删除/chmod/chown。Web 可选 root，未配置时普通身份，配置后离线 503；MCP 文件工具保持普通身份。显示实际权限模式、可写状态，权限列可修改八进制 mode、用户/UID、组/GID。
- 启用即信任整个 linuxpanel UID，同 UID 终端、PTY、自定义 collectors 可直接调用受控 root 文件通道，Web-only 不是 OS 隔离。系统文件编辑是广泛 root 管理能力，不适合不可信模块/终端用户。
- 保持模块顺序持久化，模块管理可通用上下移动保存导航顺序（不硬编码业务模块名称）；文件权限弹窗所有账户下拉框统一使用内收箭头。Nginx 网站模块尚未创建；定时任务模块在独立开发 PR 中实现，未合并、未部署。文件两排行导航、MB 两位小数、日期时间分行、Action 极简文件展示、目录大小按需统计。资源/基本信息两 Action，服务本地筛选，真实交互终端，共享 ActionEngine/MCP 参数协议保持。

## 验证与部署

本轮增加独立 root /etc 与 /root 临时对象验收、跨 UID/group socket 权限、HTTP 鉴权/CSRF、未知操作/错误输入拒绝、MCP 普通身份、根通道离线不降级，以及权限编辑浏览器回归。本机运行环境禁止监听 Unix socket，不能把本地语法/构建与无 socket 测试写成 IPC 验收通过；完整 CI 是必要证据。

2026-10-16 实机复核：独立 linux-panel-privileged.service 和普通 linux-panel.service 均为 active，socket 组为 root:linux-panel-privileged。以 linuxpanel 运行已有 verify-privileged-executor.js，/etc、/root 的随机临时文件创建、读写、版本冲突、chmod/chown、重命名和清理全部 PASS。新装仅在显式 --enable-privileged 后自动启用 root 文件 Actions；默认仍不安装，已有主机不需要重新安装应用。具体 CI/PR 与部署证据见 Issue #54。

下一步：首次安装 opt-in 的完整 CI 验收、真实 iPhone/Android QA、更多诊断模块。没有不可信插件沙箱、多管理员或独立安全审计。
