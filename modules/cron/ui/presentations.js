export default [
  {actionId:'cron.list',renderer:'scheduled-tasks',section:'managed',chrome:'minimal',loadOnEnter:true,refreshIntervalMs:0,
    operations:{save:'cron.save',remove:'cron.remove'}},
  {actionId:'cron.save',embedded:true,renderer:'metrics',fields:[{key:'id',label:'任务 ID'}]},
  {actionId:'cron.systemSet',embedded:true,renderer:'metrics',fields:[{key:'id',label:'系统任务 ID'}]},
  {actionId:'cron.remove',embedded:true,renderer:'metrics',fields:[{key:'id',label:'任务 ID'}]}
];
