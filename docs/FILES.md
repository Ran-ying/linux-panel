# 文件管理

更新：2026-10-20。文件模块通过九个文件操作 Action、分块传输 HTTP 接口和一个 Web 账户查询 Action 提供目录浏览、UTF-8 编辑、流式上传/下载及文件管理。面板负责 GUI，模块没有 CSS/Vue。

| Action | 输入 | 结果 / 行为 |
| --- | --- | --- |
| files.list | path（默认 /）、offset、limit（默认 200，最多 500） | 目录项、父目录、总数、下一页、writeAccess |
| files.accounts | 无 | 按需从 `getent passwd` / `getent group`（系统 NSS）读取用户名、UID、用户组及 GID，供 Web 下拉框选择；不暴露给 MCP，不需要 root |
| files.read | path | UTF-8 content、revision、大小、修改时间；最多 1 MiB |
| files.write | path、content、revision | 保存已读取文件，版本不符返回 409 |
| files.upload | path、contentBase64 | 兼容用的小文件上传，最多 8 MiB；覆盖同名普通文件，不能覆盖目录。界面大文件走下方分块接口 |
| files.create | path、type（file / directory） | 新建空文件或文件夹，同名返回 409 |
| files.rename | path、newPath | 同一目录内重命名，先检查目标名称冲突 |
| files.delete | path | 删除文件、链接或目录，非空目录递归删除 |
| files.chmod | path、mode（三或四位八进制） | 修改权限，拒绝对符号链接 chmod |
| files.chown | path、owner（用户名/UID）、group（组名/GID） | 至少一项，修改属主/组；符号链接修改自身 |

## 目录大小与元数据

目录项返回 size（逻辑字节数或 null）、sizeComplete、permissions（四位八进制模式，如 0755）、owner（用户:组，无法解析名称时用 UID/GID）、modifiedAt、type 和 symlink。GUI 统一用 MB，1 MB = 1,000,000 字节，固定保留两位小数。修改时间按浏览器本地时区分两行显示日期和时间；API 仍返回原始 ISO 时间。

文件夹的 size 是内部普通文件的递归逻辑大小，不是目录 inode 大小，也不是磁盘分配量；硬链接按路径计数，不遍历符号链接目标或特殊设备。单次列表共享最多 10,000 个目录项、约 1.5 秒的扫描预算（每次异步文件操作之间检查，非硬超时），以免根目录扫描拖住浏览。权限、并发变动或预算导致不完整时 sizeComplete=false，GUI 显示 ≥ 已统计 MB；目录链接/元数据无法读取时 size=null，显示 —。打开目录、翻页或变更后重新读取时临时统计当前页目录项，不持久化缓存路径和大小。

## 操作与权限

files.list 返回 accessMode:root/user 及 writeAccess:allowed/readonly/denied，按实际执行身份检查目录权限。root 执行层未配置时走普通账户（受默认 ProtectSystem/ProtectHome 限制）；显式启用后 Web 的九个文件 Actions 通过固定 root executor 访问系统目录，包括 /etc、/root。已配置但执行服务离线时返回 503，不悄悄改为普通执行。GUI 不再显示“文件权限：root”等内部执行身份提示。权限/所有者列点击后打开独立的权限弹窗，编辑八进制 mode，并从系统账户下拉框选择用户和用户组；当前属主若无法在枚举结果中找到，将作为选项保留。账户列表首次打开弹窗才加载，页面缓存本次结果。chown 先执行，随后 chmod，保存失败时刷新真实列表；两个变更并非原子事务。

七个写 Action 只在认证 Web 管道开放；MCP 文件工具 list/read 始终使用普通服务身份。启用 root socket 即信任整个 linuxpanel UID：同 UID 终端、PTY、自定义 Shell 可直接调用受控 root 文件操作。全面系统文件编辑可间接修改执行代码，不是对不可信终端的沙箱。完整安装与边界见 [权限执行层](PRIVILEGED.md)。

所有路径为绝对路径；文本读取/保存跟随符号链接到规范目标。二进制或非普通文件不能用文本编辑器打开。文本 revision 冲突检查、同目录临时替换、保留 mode/uid/gid、新建时的同名拒绝、禁止删除或重命名 / 仍有效。上传改为覆盖同名普通文件。删除和重命名处理链接本身；递归删除不跟随内部链接，非空目录 GUI 确认且不可撤销。重命名的预先冲突检查并非跨进程原子事务。新建模式仍受执行进程 umask 影响。chown 可清除特殊 mode 位，单独调用该 Action 时遵循系统行为。

普通实现拒绝 UID 0，只有独立 root handler 的显式工厂模式允许 root；所有调用走相同 fs 实现与 Schema。Web 审计/根端审计只记录 Action 等元数据，不记录路径或文件内容。分块传输审计事件为 `files.transfer`，detail 只有 `open`/`commit`/`abort`/`mkdir`/`download`，不记录每个分块、路径或字节。没有任意 root Shell Action，更新 Broker 不被用作文件执行器。

## 面板展示契约

主展示声明 chrome:minimal，隐藏通用说明/命令胶囊和操作结果、刷新、可视化/原始数据控件，保留标题及文件浏览界面。面板在 files.list 的结果区加载通用 FileBrowser，operations 引用同模块已暴露的 read/write/upload/create/rename/delete/chmod/chown Action；九个辅助 Action 声明 embedded，不单独占据卡片，但仍走同一 ActionEngine。Web presentation 校验所有引用。

操作成功提示只在目录刷新完成、忙碌状态解除时发布，避免看到保存成功后紧接上传被忽略。

导航第一排依次为上一级、路径输入框、打开目录，三者同高且保持一行；第二排依次为上传文件、上传文件夹、新建文件、新建文件夹，两个工具栏的按钮使用一致的高度及字体。去掉常驻拖放提示，但仍保留拖放。路径框、上一级和加载更多负责导航，点击文件编辑；编辑器有未保存状态与放弃提示。新建使用原有内联表单；权限、重命名、删除都使用独立原生 modal 弹窗，删除明确确认不可撤销及目录递归行为。删除成功后仅在底部短暂显示“已删除”通知。文件行提供下载。上传显示总字节进度和每个文件的进度；前面已上传的文件不会因后续失败被回滚。

`files.upload` 的 execute 路由仍允许最多 12 MiB JSON，以容纳最多 8 MiB 的 Base64。其他普通路由保持 32 KiB。分块上传不把整个文件放进 JSON。反向代理需要为 `/api/files/` 单独放行约 2 MiB 的请求体（仓库里的 Nginx 示例已这样写）；不要为了大文件把全局 `client_max_body_size` 抬到数 GB。代理设置不会被面板擅自修改，已部署的旧 vhost 需要管理员自己加上这段 location。

[模块规范](MODULE-DEVELOPMENT.md) · [安全](security.md)


## 一次拖入多个文件与文件夹（2026-10-19）

文件管理支持一次拖入**多个文件、一个或多个整个文件夹以及混合内容**。前端优先使用浏览器的 `DataTransferItem.webkitGetAsEntry`（回退到 `getAsFileSystemHandle` / `DataTransfer.files`）递归读取目录，反复调用 `readEntries` 直到读空以支持分批枚举；保留顶层文件夹、嵌套子文件夹及空目录。普通「上传文件」文件选择器继续支持多选。

每个目录用 `POST /api/files/directories` 建立或合并，每个文件用分块接口顺序写入。沿用登录、CSRF、目录写权限和路径边界。上传过程中显示总进度、单文件进度及成功/失败摘要。路径段过滤相对路径逃逸和控制字符，最多处理 3000 项，最大嵌套 32 层。某个目录创建失败将跳过其子树，其他独立文件继续处理；若有失败提供具体项目列表（前五项）。成功和失败后均刷新当前目录以显示实际状态。

同名**普通文件直接覆盖**。同名**真实目录合并**：保留目录里已有的其他内容，同名文件按覆盖写入。符号链接目录不合并，避免顺着链接写到别处。浏览器不具备读取目录的 API 时仍可拖放普通多文件，是否支持整个文件夹取决于浏览器。此改动不提升文件管理的权限，也不把上传暴露给 MCP。


### 浏览器拖入目录的可用性和上传体积

遇到 `NotFoundError`（浏览器报告 “A requested file or directory could not be found at the time an operation was processed.”）可能是浏览器发放的文件/目录句柄不可再访问，或 Finder/云盘提供的是未下载到本机的占位内容。拖放上传优先在 `drop` 事件中取得现代 `getAsFileSystemHandle()`，失败退回已获取的 WebKit 目录入口和普通 File 对象；若仅个别项目不可读，给出项目相对路径并继续上传其它文件，不能让整个文件夹失败。还增加了「上传文件夹」按钮（原生 `webkitdirectory` 选择器）作为拖放兼容性退路，可保留文件层级路径；**原生目录选择器不能列举空目录**，拖放目录仍能保留空目录。

## 分块上传、断点续传与 Range 下载（2026-10-20）

界面上传和下载不再把整个文件读进内存，也不再把文件塞进 Base64 JSON。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/api/files/uploads` | `{path,size,uploadId?}` 开始或续传。返回 `uploadId`、已接收 `offset`、`chunkSize` |
| GET | `/api/files/uploads/:uploadId` | 查询已接收字节。页面刷新后，用同一路径、大小和修改时间找回 `uploadId` 再继续 |
| PATCH | `/api/files/uploads/:uploadId` | `Content-Type: application/octet-stream`，`Upload-Offset` 与 `Content-Length`。单次最多 1 MiB，按偏移写入暂存文件 |
| POST | `/api/files/uploads/:uploadId/complete` | 长度与声明一致后，在目标目录生成临时文件并 `rename` 覆盖同名普通文件 |
| DELETE | `/api/files/uploads/:uploadId` | 放弃并删除暂存 |
| POST | `/api/files/directories` | 目录已存在则合并；已存在的普通文件返回 409；符号链接目录拒绝 |
| POST | `/api/files/downloads` | `{path}` 发放一次性下载凭证，响应里没有长期路径 |
| GET | `/api/files/downloads/:token` | 流式下载，支持 `Range`。`206` 返回 `Content-Range`，非法范围 `416` |

限制：

- 单次分块 1 MiB。Fastify 全局 `bodyLimit` 仍是 32 KiB；只有这条 PATCH 放宽到 1 MiB。execute 路由仍是 12 MiB，只服务原来的 Base64 `files.upload`。
- 单个文件最大 64 GiB。未完成会话最多 32 个，空闲 24 小时后删除；每个成功分块会顺延过期时间，避免慢速大文件传一半被清掉。
- 暂存不放在用户目录里。普通身份写 `/var/lib/linux-panel/upload-staging`（开发时在 state 文件旁边）。root 执行器写 `/var/lib/linux-panel-upload-staging`。提交时把暂存文件拷到目标目录的临时名再原子改名，这样跨文件系统也不会先截断旧文件。
- 写入路径按词法展开后，任何一级是符号链接都拒绝。覆盖同名符号链接时替换链接本身，不跟随到目标。下载与文本读取一样解析到真实普通文件。
- 偏移不一致返回 409，并带上服务器当前 `offset`。网络中断后客户端先查询再从该偏移继续，不从头重传。
- 写操作需要登录和 CSRF。下载 GET 需要登录。MCP 不提供这些接口。
- 已启用 root 执行器时，分块和下载字节经套接字版本 2 送到 `files.transfer`，不会在 root 通道离线时退回普通账户。旧的 root 包没有这个 handler，需要随面板更新安装新的固定 root 包后，root 模式下的上传下载才会可用。

Nginx 示例在 `/api/files/` 上使用 `client_max_body_size 2m`、`proxy_request_buffering off` 和 `proxy_buffering off`，读超时 300 秒。其余 location 保持 32 KiB。
