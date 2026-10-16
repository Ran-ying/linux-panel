# 文件管理

更新：2026-10-16。文件模块通过四个共享 Action 提供目录浏览、UTF-8 编辑与上传，面板负责 GUI，模块没有 CSS/Vue。

| Action | 输入 | 结果 / 行为 |
| --- | --- | --- |
| files.list | path（默认 /）、offset、limit（默认 200，最多 500） | 目录项、父目录、总数、下一页 |
| files.read | path | UTF-8 content、revision、大小、修改时间；最多 1 MiB |
| files.write | path、content、revision | 保存已读取文件，版本不符返回 409 |
| files.upload | path、contentBase64 | 创建新文件，最多 8 MiB，同名文件返回 409 |

所有路径为绝对路径。目录与文本读取遵循服务账户文件权限；符号链接按实际目标读取，编辑保存到规范目标。非普通文件和二进制内容不能用文本编辑器打开；文件内容与文件路径不写入审计，审计仅记 Action ID。文件操作拒绝 UID 0，不使用 Shell、sudo 或 root Broker。

files.write/files.upload 是明确批准的 user-files 写类型，仅 Web Cookie + CSRF/Origin 鉴权可调用；MCP 仅暴露 list/read。没有删除、权限修改或任意特权操作。保存使用同目录临时文件替换，保留权限和属主；目录无写权限或无法保留属主时会失败。上传不覆盖已有文件。

面板在 files.list 的结果区加载通用 FileBrowser，operations 引用同模块已暴露的 read/write/upload Action；三个辅助 Action 声明 embedded，不单独占据卡片，但仍走同一 ActionEngine。目录路径与上一级按钮负责导航，点击文件打开编辑器，支持加载更多。编辑器显示未保存状态，关闭或打开其他文件时提示放弃编辑。

API 的 execute 路由允许最多 12 MiB JSON，以容纳 Base64 上传；其他路由保留原有请求限制，Action Schema 继续独立限制输入。反向代理也可能有自己的上传限制；如需 8 MiB 上传，代理应允许至少 12 MiB 请求，例如 Nginx client_max_body_size 12m。代理设置不会被面板擅自修改。

[模块规范](MODULE-DEVELOPMENT.md) · [安全](security.md)
