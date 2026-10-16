import {V2RAY_CONTRACTS} from '../../platform/privileged/v2ray-contracts.js';
import {createV2RayOperations} from '../../platform/privileged/v2ray-operations.js';
export async function setup({actions,moduleId}){
  const ordinary=createV2RayOperations({requireRoot:false});
  for(const [name,contract] of Object.entries(V2RAY_CONTRACTS)){
    const write=['save','service','install'].includes(name);
    // V2Ray configuration contains credentials: never expose read/test/write
    // to anonymous callers or general MCP tools.
    actions.register(moduleId,{
      ...contract,id:'v2ray.'+name,kind:write?'write':'read',
      permission:write?'v2ray:write':'v2ray:read',
      executionPolicy:write?'privileged':undefined,
      exposure:{web:true,mcp:name==='status'},
      privileged:{channels:['web']},
      explain:write?'仅通过已安装的固定 root handler 修改 V2Ray；不会提供任意 Shell 或配置路径参数。'
        :'Web 使用受控 root 执行器读取状态与配置；MCP 仅能读取不含密钥的状态摘要。',
      execute:write?async()=>{throw Object.assign(new Error('需要启用 V2Ray root 执行器'),{statusCode:503});}
        :ordinary[name]
    });
  }
}
