# 通用 root Action 执行层

更新：2026-10-16，对应 [Issue #111](https://github.com/Ran-ying/linux-panel/issues/111)。

Web 继续以 linuxpanel 运行。管理员可另外安装独立 root executor；ActionEngine 通过 PrivilegedActionClient 请求固定 Action ID 和结构化 input。更新 Broker 专门负责可信 main 更新，不承接文件操作或任意 root Shell。

## 启用与关闭

全新安装可直接使用 `sudo bash scripts/setup.sh --apply --node-bin /opt/node24/bin/node --enable-privileged ...`，或在 `scripts/install.sh` 的首次安装命令加 `--enable-privileged`。向导交互模式会单独询问是否启用。只有明确选择时，首次安装才在 Web 启动后运行固定 root executor 安装器；否则默认关闭。安装过程中 root 端失败不会撤销已创建的 Web 账号和私有状态，应修复并使用下方单独安装命令，不要重复运行首次安装覆盖状态。若 Node 在非 root-owned 路径，指定 `--privileged-node-bin /absolute/root-owned/node`。

已有安装先更新普通面板代码，再在服务器执行一次：

```bash
sudo bash /opt/linux-panel/scripts/install-privileged-executor.sh --enable
```

默认 Node 为 /opt/node24/bin/node，可通过 --node-bin 指定另一个受 root 保护的 Node 22.12+ 路径。脚本安装固定 root-owned 包和已锁定安装的 Ajv 及其运行依赖到 /usr/local/lib/linux-panel-privileged，启动 linux-panel-privileged.service，设置 Web 的 PANEL_PRIVILEGED_SOCKET 并重启 Web。不会更改 Web 的 User、原更新 Broker、反向代理或其他业务服务。不运行 npm 的 root 安装钩子。源代码应是已经审查的可信 main。

根端包 root-only，不运行时读取 checkout 的 modules、node_modules 或私有数据目录。新版包使用 `releases/<git-sha>` 与原子 `current` 指针；源码与运行依赖清单由 `platform/privileged/package-manifest.json` 声明，固定安装器严格验证 basename。**首次安装/旧 Broker 未迁移时**仍需管理员显式启用。迁移后的受限 root Broker 会在每次可信 origin/main 更新内按已固定审核的安装协议自动同步 root handler，与普通 Web 共享健康检查、失败回滚及重启恢复事务。不使用 Web/MCP 任意 root Shell，且不会更新 systemd 特权单元自身或扩大 CapabilityBoundingSet。

关闭：

```bash
sudo bash /opt/linux-panel/scripts/install-privileged-executor.sh --disable
```

关闭独立 root 服务并移除安装器创建的 Web socket 配置后重启 Web，文件 Actions 恢复普通身份。不要在其他 EnvironmentFile 中重复配置 PANEL_PRIVILEGED_SOCKET，否则须同时移除该手工配置。卸载不会删除文件数据或修改更新 Broker。

## 明确的信任边界

安装器给 Web 服务增加专用 linux-panel-privileged supplementary group。运行目录 root:linux-panel-privileged 0750，socket 同组 0660；不复用 updater 构建时使用的 linuxpanel 读取组，也不把 updater 加入特权组。该组以外的普通用户不能连接；Web 子进程 terminal.execute、PTY 和自定义 Shell collectors 继承该组，**可以直接连接**并构造固定 root 文件 Action 请求。同 UID 不被当作不可信用户隔离。单独通过 runuser 验收时需显式加 -g linuxpanel -G linux-panel-privileged。

因此 Web-only 是 HTTP/Action 适配器的授权边界，不是对同 UID 终端的操作系统隔离。可信 MCP 的 terminal.execute 也属于这项信任；直接 MCP 文件工具 list/read 自身仍以普通账户执行。若将来要给不可信终端或多用户使用，必须先隔离执行身份，不能依靠 JSON 的 channel 字段提供强隔离。

系统文件管理是广泛 root 管理权限：编辑系统配置、启动文件或代码能间接影响代码执行。没有任意 root Shell endpoint 不等于对此类管理权限进行沙箱化。只对可信个人管理员/模块启用。

## 协议与调度

一连接一请求/响应，UTF-8 JSON 加换行：

```json
{"version":1,"action":"files.chmod","input":{"path":"/etc/example.conf","mode":"0640"},"channel":"web"}
```

根端仅接受固定注册表中的 Action，独立 Ajv 验证同一份输入 Schema；未知操作、额外参数和非 web 通道拒绝。不解释 Shell，不接收动态源码或模块路径。请求最多 12 MiB，响应客户端最多 8 MiB，最多四个同时连接。客户端 30 秒空闲超时；文件系统操作不可保证被取消，超时后应重新读取确认结果，尤其是大目录删除。

Action 元数据显式指定 privileged.channels。ActionEngine 只在客户端已配置且当前通道在声明中时调用 root；客户端再次检查受信任适配器的 authenticated/userId/channel。新写 Action 应使用 executionPolicy:privileged，仍须可信上下文；仅有 permission 字符串、exposure 或 UI 声明不授予 root。

未配置 socket 时，模块普通 execute 生效。已配置但根服务离线时返回 503，不悄悄退回普通执行。预览不调用根端。Web 输出仍经原 Action Schema 校验。根端审计只记 Action ID、成功和错误码，Web 沿用现有 Action/actor 元数据审计，不记路径、参数、内容或原始输出。

## 文件模块

九个标准 Actions 共用 file-contracts.js 和 createFileOperations：list/read/write/upload/create/rename/delete/chmod/chown。只有独立根 handler 以 privileged:true 建立实现，普通模块实现拒绝 UID 0。list 返回 accessMode:root/user 和真实 writeAccess。

MCP 只暴露普通 list/read；七个写 Action 仅在认证 Web 接口开放。保留 UTF-8/上传限制、revision 冲突、同名保护、删除/重命名根目录禁止、递归删除确认、保留 mode/uid/gid。目录和文件操作同样受真正只读挂载、不可变属性等系统限制，root 不能保证每个挂载点可写。

chmod 接收三/四位八进制，不跟随链接；chown 接收用户名/UID 和组名/GID，至少一项，数值范围 0..4294967294，名称经固定 /usr/bin/getent argv 查询，不拼接 Shell。chown 对链接使用 lchown，GUI 随后执行 chmod 恢复用户选择的 mode；两个操作不构成事务，错误后列表会重新读取。

## 后续内置模块示例

普通模块注册：

```js
const action={
  id:'example.manage',kind:'write',permission:'example:manage',
  exposure:{web:true,mcp:false},executionPolicy:'privileged',
  privileged:{channels:['web']},
  inputSchema:{type:'object',properties:{enabled:{type:'boolean'}},required:['enabled'],additionalProperties:false},
  outputSchema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},
  execute:async()=>{throw Object.assign(new Error('需要启用 root 执行层'),{statusCode:503});}
};
```

在 platform/privileged/handlers.js 静态注册同 ID、独立 input validator 和已审查的固定实现。需要新源文件/依赖时同步增加安装器的显式复制列表，不从模块目录动态发现。只有根端注册和操作员安装都完成后才具有能力；IPC、ActionEngine、鉴权与错误管道不需要另做一套。新增系统能力还要审查 root unit 的 CapabilityBoundingSet 是否允许，不扩大任意 Shell。

## 验收

CI 的 npm test 验证输入/未知操作/通道边界、HTTP 鉴权与 CSRF、socket 文件操作、离线 503 和普通 MCP 路径；专门的 sudo PANEL_ROOT_ACCEPTANCE=1 Node 测试仅在可丢弃 CI 主机执行，使用 /etc、/root 下随机临时目录，验证跨 UID/group、读取/修改/版本冲突、mode、用户名/组名及数字 UID/GID、重命名/递归删除，结束清理。浏览器在手机/桌面验证权限表单。

服务器必须实际执行安装命令，确认服务身份、socket 与根端读写结果，才能宣称已激活。仅合并 PR、普通更新 success 或根端 CI 通过不代表目标服务器已有 root 能力。最终证据记录在 [Issue #54](https://github.com/Ran-ying/linux-panel/issues/54)。

## Nginx 网站管理（新模块须额外安装）

为使固定命令 nginx -t 在沙箱内验证 listen 指令，root unit 须允许 AF_INET/AF_INET6 和 CAP_NET_BIND_SERVICE；其它固定 Handler 与 Web/MCP 授权边界不因此变化。

Nginx 模块使用固定 root handler `nginx.sites/read/check/apply`，只允许校验的站点名，写操作仅影响 sites-available 常规文件及同名 sites-enabled 链接。修改采用 revision、原子替换、nginx -t 验证；涉及已启用站点时再用固定 systemctl reload nginx.service，并在语法校验/重载失败时尝试恢复。Web 使用受控 root 通道，MCP 仅只读普通账户操作，不暴露特权写入。普通面板更新不自动更新 root handler，仍须操作员审查后显式重装。详见 [NGINX.md](NGINX.md)。

## 托管 Cron 定时任务

新模块 `cron.list/save/remove` 沿用相同固定注册表/IPC/Web 身份校验，但**只能**读写 `/etc/cron.d/linux-panel` 且每条任务静态以 `linuxpanel` 用户运行。不得接受文件路径或任意运行身份，不修改其他人的 crontab。此功能不会变成任意 root Shell API。任务本身是持久的普通账户命令能力；保存配置不等于执行已成功。

旧部署第一次启用自动 root 包更新时，需要在新版源码部署后**一次性**运行 `sudo bash /opt/linux-panel/scripts/enable-privileged-auto-updates.sh --enable`，同步已审核的 root 安装包与不可变更新 Broker。此后普通经过授权的 main 更新会同步已声明 root 文件（包括 Cron 和 Nginx），不必为每个模块重新手动安装。没有 root 通道时此模块返回 503 而非绕过权限。见 [Cron 操作规范](CRON.md)。
