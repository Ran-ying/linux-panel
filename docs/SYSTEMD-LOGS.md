# systemd 日志读取（services.logs）

「服务浏览」模块额外注册只读 Action `services.logs`，供已认证的 Web 管理员与受信任的个人 MCP 客户端使用（权限 `services:read`）。`services.list` 的原有前端筛选保持不变。

- `unit`：必填，完整的 systemd `.service` 名称，例如 `certbot.service`。
- `lines`：整数 1–200，默认 80。日志结果最多 48 KiB，并标记截断。
- root 固定执行器使用 `/usr/bin/journalctl` 和固定只读参数，不提供路径、任意标志、shell、sudo 或修改服务的能力。
- Web 使用输入栏和日志输出区域；MCP 使用同一个 JSON 结果。root socket 仅对声明 `channels:['web','mcp']` 的固定 handler 放行 MCP，原有 Web-only root handler 保持拒绝。
- root 执行器的审计仅记录 Action 名称及结果状态，绝不记录日志正文。

**重要：systemd 日志可能包含私有域名、token、口令等敏感内容。** 此能力面向受信任的个人 MCP 客户端，不把原始日志提交至公开仓库、Issue 或自动审计记录。受信任的客户端得到的是高权限只读能力，不能把同 UID 的 Web/MCP 通道视作 OS 安全隔离。

部署需要主 Web 与固定 root 版本化 Handler 同步为相同的已验证 Git SHA。即使源码已合并，若版本化 root Handler 尚未安装，Action 必须报错，不得降级为普通账户读取。运行后实机验证 `services.logs` 可调用，且不会重启/续期任何服务。