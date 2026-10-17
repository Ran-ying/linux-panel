export default [
  {actionId:'certbot.list',renderer:'certbot-manager',chrome:'minimal',loadOnEnter:true,refreshIntervalMs:0,
    operations:{renew:'certbot.renew'}},
  {actionId:'certbot.renew',embedded:true,renderer:'metrics',fields:[{key:'status',label:'续期结果'}]}
];
