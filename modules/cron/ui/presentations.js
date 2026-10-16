export default [
  {actionId:'cron.list',renderer:'scheduled-tasks',chrome:'minimal',loadOnEnter:true,refreshIntervalMs:0,
    operations:{save:'cron.save',remove:'cron.remove'}},
  {actionId:'cron.save',embedded:true,renderer:'metrics',fields:[{key:'id',label:'任务 ID'}]},
  {actionId:'cron.remove',embedded:true,renderer:'metrics',fields:[{key:'id',label:'任务 ID'}]}
];
