// Fixed, parameterless Nginx read Actions. Shared by the ordinary module and root-only handler.
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'};
const empty=object({});
export const NGINX_CONTRACTS={
  sites:{
    title:'Nginx 站点概览',description:'列出标准 Nginx 站点配置及其启用链接，不输出配置文件内容。',
    inputSchema:empty,
    outputSchema:object({
      source:str,count:{type:'integer',minimum:0},enabledCount:{type:'integer',minimum:0},
      sites:{type:'array',items:object({name:str,location:str,enabled:str,serverNames:str,listens:str,file:str})},
      warnings:{type:'array',items:str}
    })
  },
  check:{
    title:'Nginx 配置检查',description:'只运行 nginx -t，不会重载、重启或修改 Nginx。',
    inputSchema:empty,
    outputSchema:object({
      ok:{type:'boolean'},status:str,exitCode:{type:['integer','null']},output:str,identity:str
    })
  }
};
