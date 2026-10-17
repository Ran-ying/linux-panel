import {SERVICE_LOGS_CONTRACT} from '../../../platform/privileged/service-log-contracts.js';

// A read Action shared by authenticated Web and trusted personal MCP.
// Fail closed when the fixed root handler is missing or offline.
export default {
  ...SERVICE_LOGS_CONTRACT,
  id:'services.logs',kind:'read',permission:'services:read',
  exposure:{web:true,mcp:true},
  privileged:{channels:['web','mcp']},
  explain:'只允许 .service 名称和 1–200 行，固定调用 journalctl，不允许 sudo 或自定义命令。日志可能包含密码、令牌和私人地址，请勿公开转发。',
  execute:async()=>{throw Object.assign(new Error('systemd 日志功能需要已启用的最新版特权执行器'),{statusCode:503});}
};
