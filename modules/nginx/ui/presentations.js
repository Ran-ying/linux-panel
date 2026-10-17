export default [
  {actionId:'nginx.status',renderer:'nginx-service',chrome:'flat',loadOnEnter:true,refreshIntervalMs:0,
    operations:{service:'nginx.service',check:'nginx.check'}},
  {actionId:'nginx.sites',renderer:'managed-configs',chrome:'minimal',headerLayout:'inline',loadOnEnter:true,refreshIntervalMs:0,
    operations:{read:'nginx.read',apply:'nginx.apply',check:'nginx.check',
      certificates:'nginx.certificates',renew:'nginx.renew'},
    labels:{title:'网站配置',create:'新建网站',check:'检查 Nginx 配置'}},
  {actionId:'nginx.certificates',renderer:'metrics',embedded:true,
    fields:[{key:'count',label:'受管证书数量'}]},
  {actionId:'nginx.service',renderer:'metrics',embedded:true,fields:[{key:'status',label:'服务操作结果'}]},
  {actionId:'nginx.renew',renderer:'metrics',embedded:true,fields:[{key:'status',label:'证书续期结果'}]},
  {actionId:'nginx.read',renderer:'metrics',embedded:true,fields:[{key:'name',label:'配置名称'}]},
  {actionId:'nginx.apply',renderer:'metrics',embedded:true,fields:[{key:'status',label:'执行结果'}]},
  {actionId:'nginx.check',renderer:'metrics',embedded:true,fields:[{key:'status',label:'配置检查'}]},
  {actionId:'nginx.repairExecutor',renderer:'metrics',embedded:true,fields:[{key:'status',label:'修复结果'}]}
];
