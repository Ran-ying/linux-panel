import Ajv from 'ajv';
import {FILE_CONTRACTS} from './file-contracts.js';
import {createFileOperations} from './file-operations.js';
import {NGINX_CONTRACTS} from './nginx-contracts.js';
import {collectNginxSites,checkNginx} from './nginx-operations.js';
// Add reviewed built-in handlers here, then explicitly reinstall the root package.
// Never discover/import modules from the checkout or a Web-writable directory.
export function createPrivilegedHandlers({privileged=true}={}){
  const ajv=new Ajv({strict:false,allErrors:true}),operations=createFileOperations({privileged});
  const handlers=new Map(Object.entries(FILE_CONTRACTS).map(([name,contract])=>['files.'+name,{
    validate:ajv.compile(contract.inputSchema),execute:operations[name]
  }]));
  for(const [name,contract] of Object.entries(NGINX_CONTRACTS))
    handlers.set('nginx.'+name,{
      validate:ajv.compile(contract.inputSchema),
      execute:name==='sites'?()=>collectNginxSites():()=>checkNginx()
    });
  return handlers;
}
