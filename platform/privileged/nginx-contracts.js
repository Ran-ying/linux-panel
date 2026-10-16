// Fixed Nginx Actions: no caller-supplied paths or shell commands.
const text=(maxLength=65536)=>({type:'string',maxLength});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const name={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const revision={type:'string',pattern:'^([a-f0-9]{64})?$'};
const site=object({name:text(200),location:text(32),enabled:text(24),serverNames:text(350),listens:text(350),
  file:text(512),editable:{type:'boolean'},revision},['name','location','enabled','serverNames','listens','file','editable','revision']);
export const NGINX_CONTRACTS={
  sites:{title:'Nginx 网站管理',description:'查看 Nginx 站点配置、启用状态与指令摘要。',
    inputSchema:object({}),
    outputSchema:object({source:text(40),count:{type:'integer',minimum:0},enabledCount:{type:'integer',minimum:0},
      sites:{type:'array',items:site},warnings:{type:'array',items:text(512)}})},
  read:{title:'读取网站配置',description:'读取 sites-available 中指定常规文件和版本标识。',
    inputSchema:object({name}),
    outputSchema:object({name,content:text(),revision:{type:'string',pattern:'^[a-f0-9]{64}$'},enabled:{type:'boolean'}})},
  check:{title:'检查 Nginx 配置',description:'只执行 /usr/sbin/nginx -t；不会重载或写入。',
    inputSchema:object({}),
    outputSchema:object({ok:{type:'boolean'},status:text(120),exitCode:{type:['integer','null']},
      output:text(4000),identity:text(32)})},
  apply:{title:'修改 Nginx 网站',description:'原子创建、编辑、启用、停用或删除站点配置；先检验语法，再按需重载，失败恢复。',
    inputSchema:object({name,operation:{type:'string',enum:['create','edit','enable','disable','remove']},
      revision,content:text()},['name','operation','revision']),
    outputSchema:object({ok:{type:'boolean'},status:text(300),revision,validated:{type:'boolean'},
      reloaded:{type:'boolean'},output:text(4000)})}
};
