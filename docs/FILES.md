# 文件管理

更新：2026-10-16。文件模块通过七个共享 Action 提供目录浏览、UTF-8 编辑、上传及文件管理，面板负责 GUI，模块没有 CSS/Vue。

| Action | 输入 | 结果 / 行为 |
| --- | --- | --- |
| files.list | path（默认 /）、offset、limit（默认 200，最多 500） | 目录项、父目录、总数、下一页 |
| files.read | path | UTF-8 content、revision、大小、修改时间；最多 1 MiB |
| files.write | path、content、revision | 保存已读取文件，版本不符返回 409 |
| files.upload | path、contentBase64 | 创建新文件，最多 8 MiB，同名文件返回 409 |
| files.create | path、type（file / directory） | 新建空文件或文件夹，同名返回 409 |
| files.rename | path、newPath | 同一目录内重命名，先检查目标名称冲突 |
| files.delete | path | 删除文件、链接或目录，非空目录递归删除 |

## 目录大小与元数据

目录项返回 size（逻辑字节数或 null）、sizeComplete、permissions（四位八进制模式，如 0755）、owner（用户:组，无法解析名称时用 UID/GID）、modifiedAt、type 和 symlink。GUI 统一用 MB，1 MB = 1,000,000 字节，小文件保留额外小数位。

文件夹的 size 是内部普通文件的递归逻辑大小，不是目录 inode 大小，也不是磁盘分配量；硬链接按路径计数，不遍历符号链接目标或特殊设备。单次列表共享最多 10,000 个目录项、约 1.5 秒的扫描预算（每次异步文件操作之间检查，非硬超时），以免根目录扫描拖住浏览。权限、并发变动或预算导致不完整时 sizeComplete=false，GUI 显示 ≥ 已统计 MB；目录链接/元数据无法读取时 size=null，显示 —。刷新或重新打开目录重新统计，不持久化缓存路径和大小。

## 操作与权限

所有路径为绝对路径。浏览与文本读取遵循服务账户文件权限；符号链接按实际目标读取，编辑保存到规范目标。非普通文件和二进制内容不能用文本编辑器打开。文件操作拒绝 UID 0，不使用 Shell、sudo 或 root Broker，也不改变服务的现有 systemd 沙箱。

files.write/upload/create/rename/delete 是明确批准的 user-files 写类型，仅 Web Cookie + CSRF/Origin 鉴权可调用；MCP 仅暴露 list/read。保存使用同目录临时文件替换，保留权限和属主；目录无写权限或无法保留属主时会失败。上传和新建使用排他创建，不覆盖已有文件。新建模式还受服务进程 umask 影响。重命名只允许同目录，先检查名称冲突；该检查与 rename 之间不是跨进程原子事务。删除、重命名操作链接本身；删除目录不跟随内部链接，根目录禁止删除/重命名。删除非空目录无法撤销，GUI 显示路径并要求确认。文件内容与文件路径不写入审计，审计仅记 Action ID。

## 面板展示契约

面板在 files.list 的结果区加载通用 FileBrowser，operations 引用同模块已暴露的 read/write/upload/create/rename/delete Action；六个辅助 Action 声明 embedded，不单独占据卡片，但仍走同一 ActionEngine。Web presentation 校验所有引用。

操作成功提示只在目录刷新完成、忙碌状态解除时发布，避免看到保存成功后紧接上传被忽略。

路径框、上一级和加载更多负责导航，点击文件编辑；编辑器有未保存状态与放弃提示。新建与重命名使用面板内名称表单，行操作提供重命名/删除。支持文件选择和拖入当前目录上传，可一次上传多个文件，各文件仍限 8 MiB；前面已上传的文件不会因后续失败被回滚，界面会刷新列表并显示失败原因。不支持目录整体拖入上传。

API 的 execute 路由允许最多 12 MiB JSON，以容纳 Base64 上传；其他路由保留原有请求限制，Action Schema 继续独立限制输入。反向代理也可能有自己的上传限制；如需 8 MiB 上传，代理应允许至少 12 MiB 请求，例如 Nginx client_max_body_size 12m。代理设置不会被面板擅自修改。

[模块规范](MODULE-DEVELOPMENT.md) · [安全](security.md)
