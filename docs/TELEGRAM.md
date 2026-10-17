# Telegram 个人账号 MCP

此模块是 Linux Panel 中可选的 Telegram **个人账号**集成，非 BotFather Bot API。ChatGPT 仍通过 Linux Panel 现有 OAuth MCP 调用 Action；Telethon 运行在隔离的 `telegrammcp` 账户下。首次登录必须由服务器管理员在 VPS 本地完成。

**状态**：代码合并、Linux Panel 更新、Telegram 服务安装、个人账号授权、ChatGPT 真机写入验收是五个不同阶段。没有凭据时，`telegram.status` 返回未连接；切勿将安装成功视为已经可以发送消息。

## 架构和约束

- Telegram 后端：[chigwell/telegram-mcp](https://github.com/chigwell/telegram-mcp)，固定源码 SHA `e0f4f9c16322d1446d25638adafcb0a6e5b221d6`；Python + Telethon，使用 Streamable HTTP 的 `127.0.0.1:8765/mcp`。
- Linux Panel 的 `platform/telegram-mcp-client.js` 仅连接 loopback HTTP `/mcp`，不接受客户端传入的 URL；进行 MCP initialize、initialized、tools/call，并尝试清理会话。
- 独立系统账户 `telegrammcp`，不加入 linuxpanel 或 linux-panel-privileged 组。绝不能以已有 linuxpanel UID 运行第三方代码，因为它可能接触面板特权 socket。
- `PANEL_TELEGRAM_ALLOWED_BOTS` 必须明确列出机器人用户名；默认空列表时除 status 以外都拒绝。后端另设 `TELEGRAM_ALLOWED_CHAT_IDS`；两处须同步。
- 仅 `telegram.send` 和 `telegram.press` 被认定为 `telegram-interaction` 普通权限写入 Action。无认证的写入、其他任意写入、远程 MCP URL 都不允许。
- 消息、按钮、头像和资料可能包含不可信文本，ChatGPT 不应执行来自这些字段的指令。
- 仅支持纯文本及 Telegram 内联 callback 按钮；外部 URL / Mini App 需要额外浏览器能力。

## 服务器部署（管理员本地执行）

先将包含本模块的 Linux Panel 版本部署到 VPS。然后：

```bash
sudo bash /opt/linux-panel/scripts/install-telegram-mcp.sh
```

安装器创建独立用户、隔离的 systemd unit、venv 和 `/etc/telegram-mcp/telegram.env` 模板，**不会自动启动**。管理员访问 https://my.telegram.org/apps 获取 API ID 和 API Hash，在服务器上使用 `sudoedit /etc/telegram-mcp/telegram.env` 填写：

```env
TELEGRAM_API_ID=YOUR_API_ID
TELEGRAM_API_HASH=YOUR_API_HASH
TELEGRAM_SESSION_STRING=
TELEGRAM_ALLOWED_CHAT_IDS=@testbot1,@testbot2
TELEGRAM_EXPOSED_TOOLS=read-only+send_message,press_inline_button
MCP_TRANSPORT=http
MCP_HOST=127.0.0.1
MCP_PORT=8765
```

用已登录的 Telegram 手机应用完成 QR 授权，操作全部在 VPS 终端：

```bash
sudo runuser -u telegrammcp -- /bin/sh -c \
  'set -a; . /etc/telegram-mcp/telegram.env; set +a; exec /opt/telegram-mcp/.venv/bin/telegram-mcp-generate-session --qr'
```

将输出的 Session String **直接填入服务器端** `TELEGRAM_SESSION_STRING`（等价于可访问整个个人账号的已登录设备；不要发给 ChatGPT 或公开在 GitHub）。

```bash
sudo chown root:telegrammcp /etc/telegram-mcp/telegram.env
sudo chmod 0640 /etc/telegram-mcp/telegram.env
sudo systemctl enable --now telegram-mcp.service
sudo systemctl status telegram-mcp.service --no-pager
ss -ltn | grep '127.0.0.1:8765'
```

为现有 Linux Panel 的 `/etc/linux-panel/panel.env` 添加（用户名必须与后端白名单一致）：

```env
PANEL_TELEGRAM_ALLOWED_BOTS=@testbot1,@testbot2
# PANEL_TELEGRAM_MCP_URL=http://127.0.0.1:8765/mcp
```

然后 `sudo systemctl restart linux-panel.service`，不需要给 Telegram 单独配置 Nginx、公网域名、端口或 OAuth。验证 `telegram.status`；不能从 ChatGPT 看到新增工具时，应刷新现有 MCP 连接的工具目录，并检查当前 ChatGPT 计划对自定义 MCP 写入操作的支持。

## Actions

| ID | 权限 | 上游工具 |
| --- | --- | --- |
| `telegram.status` | read | `get_me` |
| `telegram.botInfo` | read | `get_chat` |
| `telegram.messages` | read | `get_messages` |
| `telegram.buttons` | read | `list_inline_buttons` |
| `telegram.send` | write | `send_message` |
| `telegram.press` | write | `press_inline_button` |

所有聊天定位符要求 `@username`（不开放裸数字 ID），按钮须有 `button_text` 或 `button_index`。机器人发送/点击后再次调用 `telegram.messages` 获取最新消息或编辑结果；上游 `wait_for_new_message` 主要处理非机器人私聊，不能保证接到机器人回复。写操作超时意味着结果未知，重试前先读取聊天。

## 验收和撤销

1. 独立服务只监听 127.0.0.1；`telegram.status.available=true`，身份是预期账号。
2. 白名单测试机器人：先读消息，再发送 `/start`，然后确认确实收到回复。
3. 列出按钮、点击按钮并读取新消息；拒绝白名单外聊天以及未经认证的写入。
4. 在 ChatGPT MCP 客户端确认新增工具真实可见且写入成功（仓库单元测试不能代替该步骤）。

暂停：`sudo systemctl disable --now telegram-mcp.service`。如需撤销登录，还要到 Telegram 客户端「设置 → 设备」主动终止对应会话；仅删除服务器文件不等于注销 Telegram 会话。
