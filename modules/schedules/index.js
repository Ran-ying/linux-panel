import {SCHEDULES_CONTRACTS} from '../../platform/privileged/schedules-contracts.js';

export async function setup({actions,moduleId}){
  for(const [name,contract] of Object.entries(SCHEDULES_CONTRACTS)){
    const read=name==='list';
    actions.register(moduleId,{
      ...contract,id:moduleId+'.'+name,kind:read?'read':'write',
      permission:read?'schedules:read':'schedules:write',
      executionPolicy:read?undefined:'privileged',
      exposure:{web:true,mcp:false},privileged:{channels:['web']},
      explain:'独立管理系统现有 Cron、用户 crontab、周期脚本、Anacron、at 队列及 systemd timers。操作只影响经过身份与 revision 校验的指定任务。',
      execute:async()=>{throw Object.assign(new Error('需要启用系统定时任务 root 执行器'),{statusCode:503});}
    });
  }
}
