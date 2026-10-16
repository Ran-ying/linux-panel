import {CRON_CONTRACTS} from './cron-contracts.js';

// Reuse exactly the existing reviewed schemas while exposing a separate system
// scheduling API. Do not add caller-supplied usernames, paths or shell commands.
export const SCHEDULES_CONTRACTS={
  list:{
    title:'系统现有定时任务',
    description:'读取现有系统 Cron、各用户 crontab、周期脚本、Anacron、at 队列与 systemd timers。',
    inputSchema:CRON_CONTRACTS.list.inputSchema,
    outputSchema:{
      type:'object',additionalProperties:false,
      required:['systemTasks','systemCount','systemWarnings'],
      properties:{
        systemTasks:CRON_CONTRACTS.list.outputSchema.properties.systemTasks,
        systemCount:CRON_CONTRACTS.list.outputSchema.properties.systemCount,
        systemWarnings:CRON_CONTRACTS.list.outputSchema.properties.systemWarnings
      }
    }
  },
  set:{
    ...CRON_CONTRACTS.systemSet,
    title:'管理系统现有定时任务'
  }
};
