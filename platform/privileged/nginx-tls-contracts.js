const str=(maxLength=1024)=>({type:'string',maxLength});
const site={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const pair=obj({certificatePath:str(512),privateKeyPath:str(512),
  publicPem:str(65536),certificatePem:str(65536),revision:str(64),privateKeyConfigured:{type:'boolean'},
  status:str(240)});
export const NGINX_TLS_CONTRACTS={
  siteTls:{
    title:'Nginx 实际证书引用',
    description:'读取已选择站点配置中实际声明的 SSL 证书和私钥路径，只返回公有 PEM；不按域名猜测证书。',
    inputSchema:obj({name:site}),
    outputSchema:obj({name:site,pairs:{type:'array',maxItems:12,items:pair},warnings:{type:'array',maxItems:20,items:str(240)}})
  },
  saveTls:{
    title:'保存 Nginx SSL 证书或私钥',
    description:'保存已引用的证书/密钥 PEM；校验匹配、并发版本及 Nginx 配置，失败回滚。',
    inputSchema:obj({name:site,index:{type:'integer',minimum:0,maximum:11},
      revision:{type:'string',minLength:64,maxLength:64,pattern:'^[a-f0-9]{64}
    title:'按需查看 Nginx 私钥',
    description:'仅已登录的 Web 管理员主动点击后，临时读取已选站点所引用的私钥；不暴露给 MCP 或普通证书列表。',
    inputSchema:obj({name:site,index:{type:'integer',minimum:0,maximum:11}}),
    outputSchema:obj({name:site,index:{type:'integer',minimum:0,maximum:11},
      privatePem:str(65536)})
  }
};
},
      certificatePem:{type:'string',minLength:1,maxLength:65536},
      privatePem:{type:'string',minLength:1,maxLength:65536},
      updateCertificate:{type:'boolean'},updatePrivateKey:{type:'boolean'}}),
    outputSchema:obj({name:site,index:{type:'integer'},ok:{type:'boolean'},
      status:str(300),revision:str(64),reloaded:{type:'boolean'}})
  },
  siteTlsKey:{
    title:'按需查看 Nginx 私钥',
    description:'仅已登录的 Web 管理员主动点击后，临时读取已选站点所引用的私钥；不暴露给 MCP 或普通证书列表。',
    inputSchema:obj({name:site,index:{type:'integer',minimum:0,maximum:11}}),
    outputSchema:obj({name:site,index:{type:'integer',minimum:0,maximum:11},
      privatePem:str(65536)})
  }
};
