export default [
  {actionId:'nginx.sites',renderer:'sections',loadOnEnter:true,refreshIntervalMs:0,
    sections:[
      {renderer:'metrics',fields:[
        {key:'count',label:'发现站点',format:'integer'},
        {key:'enabledCount',label:'启用目录/配置候选',format:'integer'},
        {key:'source',label:'来源'}
      ]},
      {renderer:'table',rowsKey:'sites',columns:[
        {key:'name',label:'配置名称'},
        {key:'enabled',label:'文件状态'},
        {key:'serverNames',label:'域名（摘要）'},
        {key:'listens',label:'监听（摘要）'},
        {key:'file',label:'文件路径'}
      ]}
    ]},
  {actionId:'nginx.check',renderer:'metrics',loadOnEnter:false,refreshIntervalMs:0,
    fields:[{key:'status',label:'校验结果'},{key:'identity',label:'执行身份'},
      {key:'exitCode',label:'退出码'},{key:'output',label:'Nginx 输出'}]}
];
