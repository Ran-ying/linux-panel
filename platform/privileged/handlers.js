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
  return handlers;
}
