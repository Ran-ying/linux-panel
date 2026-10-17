import {NGINX_CONTRACTS} from '../../platform/privileged/nginx-contracts.js';
import {createNginxOperations} from '../../platform/privileged/nginx-operations.js';
import {NGINX_UNIT_CONTRACT} from '../../platform/privileged/nginx-unit-contracts.js';
import renewalReconfigure from './actions/reconfigure-renewal.js';
import {NGINX_TLS_CONTRACTS} from '../../platform/privileged/nginx-tls-contracts.js';
import {CERTBOT_CONTRACTS} from '../../platform/privileged/certbot-contracts.js';

export async function setup({actions,moduleId}){
  const operations=createNginxOperations({requireRoot:false});
  actions.register(moduleId,renewalReconfigure);
  actions.register(moduleId,{
    ...NGINX_UNIT_CONTRACT,id:'nginx.repairExecutor',kind:'write',
    permission:'nginx:write',executionPolicy:'privileged',
    exposure:{web:true,mcp:false},privileged:{channels:['web']},
    explain:'仅以固定 Action 修复已审核 linux-panel-privileged.service 的 Nginx socket 权限，不接受 unit/path/command 输入。status、stage 和 restart 分阶段执行。',
    execute:async()=>{throw Object.assign(new Error('缺少最新版 root Handler'),{statusCode:503});}
  });
  // Registration order is the visible Nginx Action order:
  // service status first, existing website editor second, certificates last.
  const actionOrder=['status','sites','certificates','service','renew','read','apply','check'];
  for(const name of actionOrder){
    const contract=NGINX_CONTRACTS[name];
    const write=['apply','service','renew'].includes(name);
    actions.register(moduleId,{
      ...contract,id:'nginx.'+name,kind:write?'write':'read',
      permission:write?'nginx:write':'nginx:read',
      executionPolicy:write?'privileged':undefined,
      exposure:{web:true,mcp:['sites','check'].includes(name)},
      privileged:{channels:['web']},
      explain:'网站、服务和 SSL 证书操作使用受控 Action；启停、重载、证书续期必须在 Web 明确确认并通过 root 执行器。证书读取只返回公有证书元数据，不读取或输出私钥。',
      execute:write?async()=>{throw Object.assign(new Error('需要启用并安装 Nginx root 执行器'),{statusCode:503});}
        :operations[name]
    });
  }
  for(const [name,contract] of Object.entries(NGINX_TLS_CONTRACTS)){
    actions.register(moduleId,{...contract,id:'nginx.'+name,
      kind:name==='siteTlsKey'?'write':'read',permission:'nginx:read',
      executionPolicy:name==='siteTlsKey'?'privileged':undefined,
      exposure:{web:true,mcp:false},privileged:{channels:['web']},
      execute:async()=>{throw Object.assign(new Error('需要最新版 Nginx root 执行器'),{statusCode:503});}});
  }
  // Certbot renewal management belongs to the Nginx module, not an extra
  // sidebar module. The existing guarded root operations remain unchanged.
  for(const [name,contract] of Object.entries(CERTBOT_CONTRACTS)){
    const write=name==='renew';
    actions.register(moduleId,{
      ...contract,id:'nginx.certbot'+(write?'Renew':'List'),
      kind:write?'write':'read',
      permission:write?'nginx:write':'nginx:read',
      executionPolicy:write?'privileged':undefined,
      exposure:{web:true,mcp:false},privileged:{channels:['web']},
      explain:'展示 Certbot 已登记自动续期证书，按现有定时器自动续期；单证书续期检查必须经 Web 确认。',
      execute:async()=>{throw Object.assign(new Error('需要已安装的 Certbot root Handler'),{statusCode:503});}
    });
  }

}
