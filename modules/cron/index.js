import {CRON_CONTRACTS} from '../../platform/privileged/cron-contracts.js';
export async function setup({actions,moduleId}){
  for(const [name,contract] of Object.entries(CRON_CONTRACTS)){
    const read=name==='list';
    actions.register(moduleId,{
      ...contract,id:'cron.'+name,kind:read?'read':'write',
      permission:read?'cron:read':'cron:write',
      executionPolicy:read?undefined:'privileged',
      exposure:{web:true,mcp:false},privileged:{channels:['web']},
      explain:'管理专用 /etc/cron.d/linux-panel 文件；任务只以 linuxpanel 身份运行。需要显式安装新版受控 root handler，关闭 root 通道时不可使用。',
      execute:async()=>{throw Object.assign(new Error('需要启用并安装定时任务 root 执行器'),{statusCode:503});}
    });
  }
}
