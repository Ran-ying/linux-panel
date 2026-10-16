export default [
  {actionId:'schedules.list',renderer:'scheduled-tasks',section:'system',
    chrome:'minimal',loadOnEnter:true,refreshIntervalMs:0,
    operations:{systemSet:'schedules.set'}},
  {actionId:'schedules.set',embedded:true,renderer:'metrics',fields:[{key:'id',label:'系统任务 ID'}]}
];
