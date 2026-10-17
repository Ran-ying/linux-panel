# Linux Panel — Web 统一视觉规范（2026-10-17）

## 覆盖范围

检查 apps/web/src/style.css 和 App、ActionCard、FileBrowser、ListenerManager、LoginPanel、ManagedConfigs、McpSettings、NginxCertificates、NginxService、ResultRenderer、ScheduledTasks、SettingsPanel、TerminalConsole、ThemeControl、UpdateManager、V2RayManager 的组件 CSS。仅有五个业务组件含局部 style，其余依赖全局 CSS。统一色彩、几何形态、表单字重及弹窗外观；保留既定的模块布局与交互。

| 类型 | 全局规范 | 例外（保留设计意图） |
| --- | --- | --- |
| 主题 | 使用现有 light/dark palette，禁止局部硬编码颜色/旧 fallback | 终端使用独立深色 --ui-terminal-* |
| 容器 | 卡片半径 --ui-card-radius=12px，外层 --ui-shell-radius=14px | Nginx 状态、Cron 分区外壳、V2Ray 导航遵循原有 flat 结构 |
| 卡片内容 | --ui-card-padding=14px、模块间距保持现有响应式布局 | 各卡片的内容类型及数量不变 |
| 字段 | --ui-field-height=38px、--ui-input-radius=8px、标题 600、值 400 | JSON 和终端使用等宽字体；多行字段独立高度 |
| 胶囊操作 | --ui-control-height=32px、字号 .85rem、字重 500、半径 999px | Nginx 域名/状态操作为黑色 1rem 下划线、无按钮外框；移动触控目标尺寸不缩小 |
| 对话框 | --panel-bg、--border-panel、半径 12px、内距 18px、统一 shadow/backdrop | 弹窗宽度按具体任务而定 |
| 辅助访问 | --focus-ring、disabled、移动 16px 输入及 reduced-motion | 保持 sticky、滚动和键盘可用性 |

## 修改规范

1. 新 Vue scoped 样式只引用已定义的调色板和 --ui-* token，不添加裸十六进制颜色、Canvas 或不存在的 --border/--accent/--surface 回退变量。
2. 共用胶囊控件时重用面板全局 CSS。不要用强制全局 button/input reset 覆盖 Nginx 下划线操作、文件名、V2Ray 侧栏、主题切换和移动端 44px 可点击区域。
3. Cron/Nginx 弹窗表单的输入框用明确的主题色和普通字重，标签才是粗体。所有对话框采用一致背景、边框、圆角、阴影和遮罩。
4. 实现 CSS 外观调整时先修改 shared tokens，只有特殊交互才添加局部样式。禁止因为组件间有外观差异就引入 Action ID 的前端特例。

## 回归门槛

静态契约：node --test tests/web-style-contract.test.js；生产编译：npm run build:web；项目完整 CI 包含桌面 1280px 和手机 390px 浏览器回归。人工仍需核对浅色/深色下登录、系统概览、设置、文件、Cron、Nginx/SSL、V2Ray 与确认对话框；自动静态检查不能代替真实视觉测试。本轮不修改 Action/API、root 执行器或服务器配置。

2026-10-17：补充 Cron 系统任务表头筛选下拉框和独立搜索输入框。这些控件位于弹窗 task-form 外，不受弹窗通用规则覆盖；局部样式显式应用 --ui-field-height、--input-bg、--input-border、--text-primary 以及正常字重。浏览器回归须验证两种主题下的实际计算样式及前端筛选行为。
