# 终端模块

更新：2026-10-16。模块只有一个注册 Action：terminal.execute。下方交互终端是面板通用组件，不另注册多个命令 Action。

## 单次命令：Web / MCP 共用

输入：
```json
{"command":"printf 'hello\\n'; pwd","timeoutSeconds":30}
```

command 必填，1–16384 字符、不含 NUL；timeoutSeconds 可选，1–60 整数，默认 30 秒。Web 在“信息”下显示命令文本框，点击执行；MCP 使用相同输入 Schema/ActionEngine。成功调用返回 stdout、stderr、exitCode（或 null）、signal、timedOut、truncated、durationMs。退出码非零也是正常的命令执行结果，不当作传输错误；输出原文保留换行。超时终止命令进程组，输出合计最多 256 KiB，截断明确标记。

每次为独立 /bin/sh，单次命令中的 cd 不影响下一次 Action；可在同一 command 中组合 cd 和其他操作。

## 黑色交互终端

使用真实 Linux PTY + Shell，浏览器使用面板提供的 xterm 组件。连接后 cd/环境/程序状态在同一会话中保持，支持 Ctrl+C、方向键、交互程序与窗口尺寸调整。手机可用下方“终端输入/发送”作为键盘补充。需要服务器安装 python3（标准库 pty，无原生 Node 扩展）；不是 SSH 到另一台主机。

面板 REST 会话通道复用 Web Cookie/Origin/CSRF。连接属于创建它的登录会话；MCP Bearer 不能调用 Web PTY 通道。每次键入和轮询都经过现有登录验证，撤销后后台至多约 5 秒清理。页面离开尝试关闭连接，服务关闭会清理所有会话；同时最多 2 个，10 分钟无输入或 1 小时总时长关闭，输出缓冲有界，旧输出丢弃会提示。服务重启不会恢复终端。

## 权限与隐私

两种方式都仅运行在面板现有普通 Linux 服务账户，拒绝 UID 0，不使用 sudo/root Broker。命令可以修改该账户能访问的数据。terminal.execute 明确为 write / user-shell 策略，属于唯一新增批准的普通用户 Shell 写能力；其他新写 Action 仍默认拒绝。

安装/加载此模块并 exposure.mcp 后，开启 MCP 的有效可信客户端可直接调用它，旧 grant 也适用；不另加逐命令 Web 审批。更新 Broker 的开关仍只控制面板更新，不授予终端 root 权限。

命令、输入和输出只在当次响应/内存会话中保留，不写审计正文或 Shell 磁盘 history；审计只记录 Action ID / 会话开启元数据。管理员自己的命令仍可能自行写文件、后台运行或输出秘密，不能复制进公开 Issue/截图。

## 通用面板协议

模块 presentation 声明 renderer:terminal、inputs:[{key,label,type:'textarea',placeholder?}]、console:'terminal'。输入字段必须对应 inputSchema 的 string；renderer 要求 stdout/stderr 字符串；console 仅接受已批准的普通用户 Shell Action。App.vue 不检查 terminal 模块 ID，加载与样式由通用面板组件完成。

MCP 普通能力现通过 SDK fromJsonSchema 原样公布 Action.inputSchema/outputSchema，并转发实际 input；ActionEngine 再校验。此前空参数缺口已补齐，包含嵌套/数组/数值边界与非法参数测试。更新工具保留独立的受限执行策略。

[模块规范](MODULE-DEVELOPMENT.md) · [MCP](mcp.md) · [当前状态](PROJECT-STATUS.md)

生产 HTML 为面板终端的动态样式提供每次页面独立的 CSP style nonce；脚本仍只允许 self，不使用 unsafe-inline。终端模块不提供任意样式注入接口。
