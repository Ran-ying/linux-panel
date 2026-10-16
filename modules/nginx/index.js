import {NGINX_CONTRACTS} from '../../platform/privileged/nginx-contracts.js';
import {createNginxOperations} from '../../platform/privileged/nginx-operations.js';
import {NGINX_UNIT_CONTRACT} from '../../platform/privileged/nginx-unit-contracts.js';

export async function setup({actions,moduleId}){
  const operations=createNginxOperations({requireRoot:false});
  actions.register(moduleId,{
    ...NGINX_UNIT_CONTRACT,id:'nginx.repairExecutor',kind:'write',
    permission:'nginx:write',executionPolicy:'privileged',
    exposure:{web:true,mcp:false},privileged:{channels:['web']},
    explain:'仅以固定 Action 修复已审核 linux-panel-privileged.service 的 Nginx socket 权限，不接受 unit/path/command 输入。status、stage 和 restart 分阶段执行。',
    execute:async()=>{throw Object.assign(new Error('缺少最新版 root Handler'),{statusCode:503});}
  });
  for(const [name,contract] of Object.entries(NGINX_CONTRACTS)){
    const write=name==='apply';
    actions.register(moduleId,{
      ...contract,id:'nginx.'+name,kind:write?'write':'read',
      permission:write?'nginx:write':'nginx:read',
      executionPolicy:write?'privileged':undefined,
      exposure:{web:true,mcp:name==='sites'||name==='check'},
      privileged:{channels:['web']},
      explain:'Web 使用显式安装的 root Action 执行器；普通 MCP 只能查看站点摘要、运行普通身份的配置检查。网站写入必须通过 Web root 执行器，且不会自动对外修改 Nginx。',
      execute:write?async()=>{throw Object.assign(new Error('需要启用并安装 Nginx root 执行器'),{statusCode:503});}
        :operations[name]
    });
  }
}
