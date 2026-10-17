import {CERTBOT_CONTRACTS} from '../../platform/privileged/certbot-contracts.js';
export async function setup({actions,moduleId}){
  for(const [name,contract] of Object.entries(CERTBOT_CONTRACTS)){
    actions.register(moduleId,{
      ...contract,id:'certbot.'+name,kind:name==='list'?'read':'write',
      permission:name==='list'?'certbot:read':'certbot:write',
      executionPolicy:name==='renew'?'privileged':undefined,
      exposure:{web:true,mcp:false},privileged:{channels:['web']},
      explain:'只列出 Certbot 已登记续期配置、证书有效期及定时器状态；续期需要 Web 明确确认、不得强制签发或读取私钥。',
      execute:async()=>{throw Object.assign(new Error('需要已安装的 Certbot root Handler'),{statusCode:503});}
    });
  }
}
