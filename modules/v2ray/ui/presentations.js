export default [
  {actionId:'v2ray.status',renderer:'v2ray-manager',chrome:'minimal',loadOnEnter:true,refreshIntervalMs:0,
    operations:{read:'v2ray.read',test:'v2ray.test',save:'v2ray.save',
      service:'v2ray.service',install:'v2ray.install'}},
  {actionId:'v2ray.read',renderer:'metrics',embedded:true,fields:[{key:'configPath',label:'配置文件'}]},
  {actionId:'v2ray.test',renderer:'metrics',embedded:true,fields:[{key:'message',label:'校验结果'}]},
  {actionId:'v2ray.save',renderer:'metrics',embedded:true,fields:[{key:'message',label:'保存结果'}]},
  {actionId:'v2ray.service',renderer:'metrics',embedded:true,fields:[{key:'message',label:'服务操作结果'}]},
  {actionId:'v2ray.install',renderer:'metrics',embedded:true,fields:[{key:'message',label:'安装结果'}]}
];
