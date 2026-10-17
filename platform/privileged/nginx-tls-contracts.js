const str=(maxLength=1024)=>({type:'string',maxLength});
const site={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const pair=obj({certificatePath:str(512),privateKeyPath:str(512),
  publicPem:str(65536),certificatePem:str(65536),revision:str(64),
  privateKeyConfigured:{type:'boolean'},status:str(240)});
export const NGINX_TLS_CONTRACTS={
  siteTls:{
    title:'Nginx 实际证书引用',
    description:'读取站点配置中声明的证书和私钥路径；公有 PEM 和版本信息，不包含私钥正文。',
    inputSchema:obj({name:site}),
    outputSchema:obj({name:site,pairs:{type:'array',maxItems:12,items:pair},
      warnings:{type:'array',maxItems:20,items:str(240)}})
  },
  saveTls:{
    title:'保存 Nginx SSL 证书或私钥',
    description:'固定文件引用，检查版本、证书与私钥配对，验证和重载 Nginx；失败自动恢复。',
    inputSchema:obj({name:site,index:{type:'integer',minimum:0,maximum:11},
      revision:{type:'string',minLength:64,maxLength:64,pattern:'^[a-f0-9]{64}$'},
      certificatePem:{type:'string',minLength:1,maxLength:65536},
      privatePem:{type:'string',minLength:1,maxLength:65536},
      updateCertificate:{type:'boolean'},updatePrivateKey:{type:'boolean'}}),
    outputSchema:obj({name:site,index:{type:'integer'},ok:{type:'boolean'},
      status:str(300),revision:str(64),reloaded:{type:'boolean'}})
  },
  siteTlsKey:{
    title:'读取 Nginx 私钥',
    description:'仅已登录 Web 管理员可读取站点引用的私钥；不会通过普通证书列表或 MCP 返回。',
    inputSchema:obj({name:site,index:{type:'integer',minimum:0,maximum:11}}),
    outputSchema:obj({name:site,index:{type:'integer',minimum:0,maximum:11},
      privatePem:str(65536)})
  }
};
