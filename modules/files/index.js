import {createFileOperations} from '../../platform/privileged/file-operations.js';
import {FILE_CONTRACTS} from '../../platform/privileged/file-contracts.js';
export async function setup({actions,moduleId}){
  const operations=createFileOperations();
  for(const [name,contract] of Object.entries(FILE_CONTRACTS)){
    const read=['list','read'].includes(name);
    actions.register(moduleId,{...contract,id:'files.'+name,kind:read?'read':'write',
      permission:read?'files:read':'files:write',executionPolicy:read?undefined:'user-files',
      exposure:{web:true,mcp:read},privileged:{channels:['web']},
      explain:'Web 在启用 root 执行层后使用系统级文件权限；未启用时使用普通服务账户。MCP 文件读取直接使用普通账户。',
      execute:operations[name]});
  }
}
