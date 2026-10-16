export default [
  {actionId:'nginx.sites',renderer:'managed-configs',chrome:'minimal',loadOnEnter:true,refreshIntervalMs:0,
    operations:{read:'nginx.read',apply:'nginx.apply',check:'nginx.check'},
    labels:{title:'网站配置',create:'新建网站',check:'检查 Nginx 配置'}},
  {actionId:'nginx.read',renderer:'metrics',embedded:true,fields:[{key:'name',label:'配置名称'}]},
  {actionId:'nginx.apply',renderer:'metrics',embedded:true,fields:[{key:'status',label:'执行结果'}]},
  {actionId:'nginx.check',renderer:'metrics',embedded:true,fields:[{key:'status',label:'配置检查'}]}
];
