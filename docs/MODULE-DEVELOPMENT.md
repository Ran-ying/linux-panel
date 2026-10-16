# 模块开发规范（开发者 / AI）

协议更新：2026-10-16。先读 [AGENTS](../AGENTS.md)、[当前状态](PROJECT-STATUS.md)，再按本规范实现。旧历史快照不覆盖当前契约。

## 职责边界

| 内容 | 负责人 |
| --- | --- |
| 布局、导航、主题、圆角、间距、响应式、PWA、登录/会话 | 面板 |
| Action 卡片、说明/命令、保存、刷新、原始输出与 JSON、通用文件浏览器 | 面板 ActionCard |
| 指标、进度条、圆环卡片、表格、组合分区 | 面板 ResultRenderer |
| 采集/解析、输入输出 Schema、标题与说明 | 模块 |
| 展示字段、标签、单位、分区、刷新建议 | 模块的 JSON 型 presentation |
| 授权、CSRF/Origin、命令配置持久化、执行限制、输出校验 | 面板基础设施 |

内置业务模块没有 CSS、Vue 页面或浏览器脚本；所有实际 GUI 样式来自面板。模块用声明式配置选择展示能力，不按百分比分配样式。新模块应无需修改 App.vue、导航或全局 CSS。缺能力时先增加通用、可校验的面板 renderer，而不是按业务 Action ID 拼接界面。

模块是随仓库发布的受信任 JavaScript，不是代码沙箱或插件市场。当前没有运行中安装/卸载、上传第三方模块或任意 Vue 组件协议。

## 文件与发现

```text
modules/example/
  manifest.json
  index.js
  actions/status.js
  ui/presentations.js
  collectors/           # 可选内部帮助函数，不注册 Action
```

manifest.id 必须等于目录名，entry 必须为 ./index.js；dependencies 为现有模块 ID，加载器检查缺失和循环依赖。setup 只接收 {actions,moduleId}，不能假设有数据库或 root 能力的注入。

可选 manifest.navigationOrder 为有限数字，仅用于首次初始化导航顺序。面板将顺序保存在私有状态 moduleOrder；管理员可在「面板设置 → 模块管理」通过上移/下移调整任意已安装业务模块，立即保存并更新导航，不按模块名称写特殊排序规则；已卸载但仍记录的模块位置保持，以便恢复加载。之后发现的新模块无论该值如何都追加末尾。不要通过模块名称、Action ID 或 Vue 特判控制导航；依赖装载顺序与显示顺序独立。

manifest.json：
```json
{"id":"example","name":"示例监控","version":"0.1.0","entry":"./index.js","dependencies":[]}
```

index.js：
```js
import status from './actions/status.js';
export async function setup({actions,moduleId}) {
  actions.register(moduleId,status);
}
```

## 一个操作，一个 Action

ID 以模块 ID + "." 开头且全局唯一。业务需要一起刷新、配置的结果放在同一个 Action 的字段/子对象中，不依赖前端调用多个 Action 拼装。

内置规范要求 id、title、description、explain、kind、permission、exposure、inputSchema、outputSchema、execute。kind 为 read/write；exposure.web/mcp 明确声明。Schema 必须描述 object，优先 required 和 additionalProperties:false，声明类型与合理数值范围。execute 返回 JSON 对象，不返回 BigInt、undefined、函数或非有限数；引擎验证输入与输出。

permission 是操作语义，不自行授予权限。Web/MCP 适配器负责授权；写操作引擎默认拒绝，新写类型须先实现并审查面板执行策略；terminal.execute 是明确批准的普通用户 Shell 特例，不代表任意模块 write 自动获准。不能通过 read 标签或 presentation 绕过写策略。root 更新 Broker 只处理固定可信 main 更新任务，不能用于模块 Shell。

system.info 只采集 platform、distribution（发行版及版本）、release（内核）、arch、uptimeSeconds、nodeVersion，不再采集 hostname/cpuCount/totalMemoryBytes/freeMemoryBytes。CPU 的 availableParallelism 属于 system.resources.cpu；旧 info.cpuCount 命令自动沿用。

当前系统 Action 只有 system.resources（cpu + memory + disk，排在前面）和 system.info（主机基本字段）；另有 services.list。旧 system.cpu/system.memory/storage.usage 已删除，无隐藏别名。collectors 不是注册的 Action。

## 可复制的最小示例

actions/status.js：
```js
import os from 'node:os';
export default {
  id:'example.status',title:'主机运行时间',
  description:'读取当前主机运行秒数。',
  explain:'Linux 读取 /proc/uptime；其他平台使用 os.uptime()。',
  kind:'read',permission:'example:read',exposure:{web:true,mcp:true},
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  outputSchema:{type:'object',required:['uptimeSeconds'],additionalProperties:false,
    properties:{uptimeSeconds:{type:'number',minimum:0}}},
  terminal:{
    fields:{uptimeSeconds:"cut -d ' ' -f1 /proc/uptime"},
    decode:values=>({uptimeSeconds:Number(values.uptimeSeconds)})
  },
  createPlan:async()=>[{type:'node-api',code:'os.uptime()'}],
  execute:async()=>({uptimeSeconds:os.uptime()})
};
```

ui/presentations.js：
```js
export default [{
  actionId:'example.status',renderer:'metrics',
  fields:[{key:'uptimeSeconds',label:'运行时间',format:'duration'}],
  loadOnEnter:true,refreshIntervalMs:0
}];
```

不要在模块 import/setup 中启动定时器、监听端口或执行后台命令。测试应在临时目录加载此模块，经 ActionEngine 验证 schema，而不是只调用解析函数。

## 可编辑终端命令与原始输出

terminal 可选；Linux read Action 同时提供 fields/decode 才使用统一终端执行器，否则调用 execute。fields 是固定 key → 默认 Shell；decode 接收修剪首尾空白后的字符串及第二参数 {durations,input}（命令耗时毫秒与经过 Schema 校验的 Action 输入）。原始 key 与 raw 列表一致，decode 中不再执行命令。

GET/PUT /api/actions/:id/commands 由面板统一提供，Web 管理员入口检查权限/Origin/CSRF。保存不执行；只接受字段集合精确匹配、非空、无 NUL、每值最多 2048 字符。存储在私有 state.actionCommands；审计只记 Action ID。

Linux 执行通过 timeout + /bin/sh -c，以现有非 root 服务身份，每条命令 5 秒、128 KiB，拒绝 UID 0，不能 sudo/借用 root Broker。管理员自定义 Shell 能修改普通账户可访问的数据；read 标签不是只读沙箱。

引擎返回 {action,result,raw?}：result 经 decode/schema 校验；raw 为 key → {stdout,stderr,exitCode}，保留成功命令的原始空白。执行失败或输出格式错误返回错误，不保证部分 raw。Web 展示 raw 表格和底部 JSON；当前 MCP 适配器只返回 result。raw 仅当次响应，不是执行历史，不写审计/静态文件/公开日志。

配置改名可在 terminal 下声明：
```js
migrateFrom:{newKey:{actionId:'old.action',key:'oldKey'}}
```
migrateFrom 的值也可为有序数组，例如 filesystem:[{actionId:'system.info',key:'filesystem'},{actionId:'storage.usage',key:'filesystem'}]。优先当前已保存值 → 按顺序找到的旧字段 → 默认值。保存写当前 Action；旧私有条目保留。改 key/Action ID 属于兼容性变更，必须更新升级说明并测试迁移优先级。

## 展示协议

presentation 只能引用自己模块对 Web 暴露的 Action。配置为 JSON 数据，不带回调、HTML、CSS、远程脚本或组件路径；它不能注册 Action、授权或启动服务器定时任务。没有配置时面板回退展示结构化结果。

| renderer | 字段 |
| --- | --- |
| metrics | 非空 fields:[{key,label,format?}] |
| progress | title、数值 valueKey；可选 totalKey/usedKey/availableKey、details |
| gauge | title、百分比 valueKey；totalKey 或非空 details 至少提供一种；可选 usedKey、quantityFormat（bytes/number）、unit |
| table | rowsKey 指向对象数组；非空 columns:[{key,label,format?}] |
| sections | 非空 sections:[子展示]；子项 key 指向当前结果的对象字段，省略则用当前对象；可选 layout:'grid' 并排展示 |
| files | path/entries 输出，operations:{accounts,read,write,upload,create,rename,delete,chmod,chown} 引用同模块 Web Action |
| managed-configs | sites[]、count/启用数；operations:{read,apply,check} 引用相同模块的读/写 Actions，面板提供通用配置编辑和确认弹窗 |
| scheduled-tasks | tasks[]、revision、count；可选 systemTasks[]、systemCount、systemWarnings；operations:{save,remove,systemSet} 引用同模块已暴露的写 Action，Web 面板分组显示系统任务、面板任务，并按受控类型提供编辑/启停/删除确认 |
| terminal | result 中 stdout/stderr 字符串，显示黑色命令结果 |

format 只支持 bytes/duration/milliseconds/integer/number；省略按文本显示。key 是当前对象的直接字段，不是表达式或点路径。嵌套对象用 sections.key；进度百分比必须声明为 number；圆环数量字段可为 number/integer，未给 usedKey 时用百分比 × 总量计算等效用量；表格列须在 rowsKey 的 items.properties 中存在。sections 每层最多 12 项、最多三层分区，所有子引用按对应 outputSchema 校验。

同一 Action 返回嵌套资源对象的示例（CPU 圆环显示整机百分比，下方列出逻辑处理器和可用并行度，避免“小数核数”表述）：
```js
{
  actionId:'example.resources',renderer:'sections',layout:'grid',
  loadOnEnter:true,refreshIntervalMs:5000,sections:[
    {key:'cpu',renderer:'gauge',title:'CPU',valueKey:'usagePercent',details:[{key:'logicalCpus',label:'逻辑处理器',format:'integer'},{key:'availableParallelism',label:'可用并行度',format:'integer'}]},
    {key:'memory',renderer:'gauge',title:'内存',valueKey:'usagePercent',totalKey:'totalBytes',usedKey:'usedBytes',quantityFormat:'bytes'}
  ]
}
```

loadOnEnter 仅允许无需必填参数的 read；自动刷新默认关闭，由用户开启。refreshIntervalMs 为 0 或 3000–60000 整数。输入支持声明式 string textarea、text 和 select；select.optionsKey 指向当前 Action 输出中的 string 数组，面板补充空值“全部”选项；其他字段仍可使用 JSON 编辑器。复杂表单有需求先扩展面板，不另建绕过引擎的业务 API。

## MCP 参数映射与输入控件

MCP 工具通过 SDK fromJsonSchema 公布模块 Action.inputSchema/outputSchema，实际参数传给同一 ActionEngine；必填/可选/嵌套对象/数组/边界和未知字段由 schema 校验，已补齐原空参数缺口。

presentation.inputs 可声明 [{key,label,type:'textarea'|'text'|'select',placeholder?,optionsKey?}]，字段必须存在于 inputSchema 且为 string；select 的 optionsKey 必须对应 outputSchema 中 string 数组，inputsLabel 可声明输入区标题；面板在信息区下方渲染输入。未声明时仍使用通用 JSON 编辑器。只对无需输入的 read 自动加载，不因有展示配置就自动执行写操作。

presentation.embedded:true 可将辅助 Action 从独立卡片中隐藏，由主展示通过已校验的 operations 引用调用；它不改变 API 暴露或授权。files renderer 的模块契约见 [文件管理](FILES.md)。

表格可声明 clientFilters:[{key,field,match:'contains'|'exact'}]，key 对应 string 输入、field 对应 rowsKey 元素中的 string 输出；面板对已经读取的行实时筛选，不重新调用 Action。“刷新数据”仍重新读取完整数据。服务模块保留可供 API 使用的后端筛选参数，Web 使用本地筛选。

renderer:'terminal' 复用面板黑色 stdout/stderr 结果视图；console:'terminal' 在 Action 卡片下方提供通用真实 PTY 组件，仅适用于已批准的普通用户 Shell 能力。模块不附带 CSS/Vue，具体参考 [终端规范](TERMINAL.md)。

## AI 实施与交付检查表

1. 读当前状态，确认命名/依赖/权限；实现 collectors → Action → presentation。
2. 测采集解析的缺失/错误/边界与单位换算，经 ActionEngine 测完整输出 schema。真实 Shell 在普通 Linux 身份测试；root 环境验证拒绝或明确跳过。
3. 测发现/注册、旧 ID 退役、命令迁移优先级；新 renderer 测非法/跨 schema 引用拒绝。
4. Web/MCP 复用同一 Action。测试 tools/list 与调用；可信个人模式不新增逐工具 Scope/白名单。
5. 浏览器测保存后生效、原始 key/原文、说明默认隐藏、主题与手机布局；新增普通模块无需修改 App.vue。
6. 运行 npm run check、npm test、npm run build:web，按 CI 配置做浏览器验收。工件不能包含真实凭据/主机数据/私有命令。
7. 同一 PR 同步受影响 README/架构/模块/MCP/升级/安全文档及 PROJECT-STATUS。旧过程移 docs/history 并标明日期，当前状态不反复叠加矛盾旧快照。
8. CI 通过后按授权合并/部署；queued 不是成功，核对持久化 SHA 和服务状态，最终部署证据统一记 Issue #54，当前文档链接该记录，避免重复缓存失效的运行版本。未观察的状态写待验证。

源码入口：core/module-manager.js、action-registry.js、action-engine.js，platform/action-commands.js，apps/api/src/web-presentations.js，ActionCard.vue、ResultRenderer.vue、modules/system。不要发明不存在的模块 API。

`presentation.chrome: "minimal"` 可用于自带交互控件的通用 renderer（如 files），隐藏 Action 说明/命令胶囊、操作结果标题及刷新/视图切换；默认 standard 保持既有界面。它只改变 Web 外观，不改变 Action 说明、Schema、权限或 API/MCP 暴露。

## 复用 root 能力（Issue #111）

平台提供 PrivilegedActionClient，由 ActionEngine 使用。模块 Action 可显式声明 privileged:{channels:['web']}；普通默认 execute 用于 root 通道未配置时的退化行为。新的高权限写 Action 还应使用 executionPolicy:'privileged'、明确 permission/exposure、输入输出 Schema。permission 字符串或 presentation 都不会授予 root。

真正提权还需要在 platform/privileged/handlers.js 静态注册已审查 handler 与独立输入 validator，再由操作员重跑安装器，把固定文件及其可信依赖安装到 root-only 包。不要动态 import modules 目录或任何 linuxpanel 可写路径；不要接收任意 Shell。文件模块共享 file-contracts.js 与 file-operations.js，新增模块同样复用客户端、IPC、校验调度和安装流程，只增加已审查的根端实现/必要能力。首版根端只接受 web 通道，扩展 MCP 需同步根端授权设计。

启用后同 UID 的终端/PTY/自定义 collectors 也能调用受控 root socket，不能宣称 Web-only 是 OS 隔离。参见 [权限执行层及扩展示例](PRIVILEGED.md)。
