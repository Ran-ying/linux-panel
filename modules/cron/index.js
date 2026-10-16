import {CRON_CONTRACTS} from '../../platform/privileged/cron-contracts.js';
export async function setup({actions,moduleId}){
  for(const [name,contract] of Object.entries(CRON_CONTRACTS)){
    const read=name==='list';
    actions.register(moduleId,{
      ...contract,id:'cron.'+name,kind:read?'read':'write',
      permission:read?'cron:read':'cron:write',
      executionPolicy:read?undefined:'privileged',
      exposure:{web:true,mcp:false},privileged:{channels:['web']},
      explain:'系统级读取 Cron、用户 crontab、周期脚本与 systemd timers。新建的面板任务仍使用专用 linuxpanel 配置；原有系统任务只通过匹配来源与 revision 的受控操作修改，不覆盖其他条目。',
      execute:async()=>{throw Object.assign(new Error('需要启用并安装定时任务 root 执行器'),{statusCode:503});}
    });
  }
}
