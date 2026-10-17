import Ajv from 'ajv';
import {FILE_CONTRACTS} from './file-contracts.js';
import {createFileOperations} from './file-operations.js';
import {CRON_CONTRACTS} from './cron-contracts.js';
import {createCronOperations} from './cron-operations.js';
import {NGINX_CONTRACTS} from './nginx-contracts.js';
import {createNginxOperations} from './nginx-operations.js';
import {NGINX_UNIT_CONTRACT} from './nginx-unit-contracts.js';
import {createNginxUnitOperations} from './nginx-unit-operations.js';
import {V2RAY_CONTRACTS} from './v2ray-contracts.js';
import {createV2RayOperations} from './v2ray-operations.js';
import {SERVICE_LOGS_CONTRACT} from './service-log-contracts.js';
import {createServiceLogOperations} from './service-log-operations.js';
import {NGINX_TLS_CONTRACTS} from './nginx-tls-contracts.js';
import {createNginxTlsOperations} from './nginx-tls-operations.js';
import {CERTBOT_CONTRACTS} from './certbot-contracts.js';
import {createCertbotOperations} from './certbot-operations.js';
import {createNginxRenewalReconfigure,NGINX_RECONFIGURE_CONTRACT} from './nginx-renewal-reconfigure.js';
// Add reviewed built-in handlers here, then explicitly reinstall the root package.
// Never discover/import modules from the checkout or a Web-writable directory.
export function createPrivilegedHandlers({privileged=true}={}){
  const ajv=new Ajv({strict:false,allErrors:true}),operations=createFileOperations({privileged});
  const handlers=new Map(Object.entries(FILE_CONTRACTS).map(([name,contract])=>['files.'+name,{
    validate:ajv.compile(contract.inputSchema),execute:operations[name]
  }]));
  const cron=createCronOperations();
  for(const [name,contract] of Object.entries(CRON_CONTRACTS))
    handlers.set('cron.'+name,{validate:ajv.compile(contract.inputSchema),execute:cron[name]});
  const nginx=createNginxOperations();
  for(const [name,contract] of Object.entries(NGINX_CONTRACTS))
    handlers.set('nginx.'+name,{validate:ajv.compile(contract.inputSchema),execute:nginx[name]});
  const unitRepair=createNginxUnitOperations();
  handlers.set('nginx.repairExecutor',{
    validate:ajv.compile(NGINX_UNIT_CONTRACT.inputSchema),execute:unitRepair.repair
  });
  const v2ray=createV2RayOperations({requireRoot:privileged});
  for(const [name,contract] of Object.entries(V2RAY_CONTRACTS))
    handlers.set('v2ray.'+name,{validate:ajv.compile(contract.inputSchema),execute:v2ray[name]});
  const journal=createServiceLogOperations();
  handlers.set('services.logs',{channels:['web','mcp'],validate:ajv.compile(SERVICE_LOGS_CONTRACT.inputSchema),execute:journal.logs});
  handlers.set('nginx.reconfigureRenewal',{
    channels:['mcp'],validate:ajv.compile(NGINX_RECONFIGURE_CONTRACT.inputSchema),
    execute:createNginxRenewalReconfigure().reconfigure
  });
  const tls=createNginxTlsOperations();
  for(const [name,contract] of Object.entries(NGINX_TLS_CONTRACTS))
    handlers.set('nginx.'+name,{channels:['web'],validate:ajv.compile(contract.inputSchema),execute:tls[name]});
  const certbot=createCertbotOperations();
  for(const [name,contract] of Object.entries(CERTBOT_CONTRACTS)){
    const action=name==='renew'?'nginx.certbotRenew':'nginx.certbotList';
    handlers.set(action,{channels:['web'],validate:ajv.compile(contract.inputSchema),execute:certbot[name]});
  }
  return handlers;
}
