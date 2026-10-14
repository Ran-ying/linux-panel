# v0.3 开发及部署约定

## 本地开发与初始化

MacBook 上执行 `npm ci`、`npm test`、`npm run check`、`npm run build:web`。首次运行执行 `npm run admin:init`，通过终端交互式隐藏输入创建管理员；随后分别运行 `npm run dev:api` 和 `npm run dev:web`。

本地开发服务绑定 `127.0.0.1:4188`，Vite 前端监听 `127.0.0.1:5173`。

## 持久化

面板默认存储 `data/panel-state.json`（0600）。数据目录必须由运行面板的非 root 账号私有控制；禁止将其置于 Nginx 静态目录、上传到公开 GitHub 仓库或镜像构建层中。可通过 `PANEL_DATA_DIR` 更改数据目录，并对文件进行受控备份。**v0.3 只能使用单个 Fastify 进程写这个 JSON 文件**，不能在多个 Node 实例间共享状态。

## Nginx 公网方案（计划，尚不执行）

计划中的公网入口由 Nginx HTTPS 反向代理到本机 Fastify。生产模式要求配置 `PANEL_PUBLIC_ORIGIN=https://linux.rany.ing` 以识别浏览器请求 Origin 并发送 Secure Cookie。由于当前版本仍未完成公网安全审计，**暂时不要配置 Nginx 公网转发或开放 MCP**。

将来正式部署前需逐一审查 TLS、主机隔离、Nginx 访问控制、限流、代理报头、登录/恢复、权限、日志、回滚及备份。不要触碰旧 VPS 上现有宝塔、Nginx、PHP、MySQL、Redis 和 PM2 项目。当前旧 CentOS 7 VPS 不适合作为公网面板部署环境。

## v0.3 测试重点

未初始化不能登录；无账号自注册；未登录不能获取系统数据；合法登录和设置操作；CSRF 与 Origin 限制；会话撤销、密码修改；禁用所有业务模块后依然能使用面板设置。还要在 MacBook 上手动验证登录页面、Cookie 行为与 UI 交互。
