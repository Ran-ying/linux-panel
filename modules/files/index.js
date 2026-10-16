import {createFileOperations} from '../../platform/privileged/file-operations.js';
import {FILE_CONTRACTS} from '../../platform/privileged/file-contracts.js';
import {listAccounts} from './accounts.js';
export async function setup({actions,moduleId}){
  const operations=createFileOperations();
  actions.register(moduleId,{
    id:'files.accounts',title:'系统用户与用户组',
    description:'读取系统 NSS 用户和用户组供文件归属选择。',
    explain:'仅 Web 文件管理权限编辑弹窗使用 getent passwd/group，不需要 root，按需加载。',
    kind:'read',permission:'files:read',exposure:{web:true,mcp:false},
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    outputSchema:{type:'object',required:['users','groups'],additionalProperties:false,
      properties:{users:{type:'array',items:{type:'object',required:['name','id'],additionalProperties:false,
        properties:{name:{type:'string'},id:{type:'integer',minimum:0}}}},
        groups:{type:'array',items:{type:'object',required:['name','id'],additionalProperties:false,
        properties:{name:{type:'string'},id:{type:'integer',minimum:0}}}}}},
    execute:listAccounts
  });
  for(const [name,contract] of Object.entries(FILE_CONTRACTS)){
    const read=['list','read'].includes(name);
    actions.register(moduleId,{...contract,id:'files.'+name,kind:read?'read':'write',
      permission:read?'files:read':'files:write',executionPolicy:read?undefined:'user-files',
      exposure:{web:true,mcp:read},privileged:{channels:['web']},
      explain:'Web 在启用 root 执行层后使用系统级文件权限；未启用时使用普通服务账户。MCP 文件读取直接使用普通账户。',
      execute:operations[name]});
  }
}
