import {listFiles,readText,writeText,uploadFile,TEXT_LIMIT,UPLOAD_LIMIT} from './fs.js';
const path={type:'string',minLength:1,maxLength:4096};
const input=properties=>({type:'object',additionalProperties:false,properties});
const string={type:'string'},integer={type:'integer',minimum:0};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const revision={type:'string',pattern:'^[a-f0-9]{64}$'};
export async function setup({actions,moduleId}){
  const common={permission:'files:read',kind:'read',exposure:{web:true,mcp:true},
    explain:'以面板普通服务账户访问文件系统，不提升权限。路径为绝对路径，读取不会修改文件。'};
  actions.register(moduleId,{...common,id:'files.list',title:'文件浏览',
    description:'分页列出目录、文件大小和修改时间。',
    inputSchema:input({path,offset:integer,limit:{type:'integer',minimum:1,maximum:500}}),
    outputSchema:object({path:string,parent:{type:['string','null']},total:integer,nextOffset:{type:['integer','null']},
      entries:{type:'array',items:object({name:string,type:{type:'string',enum:['directory','file','other']},
        symlink:{type:'boolean'},size:integer,modifiedAt:string})}}),
    execute:listFiles});
  actions.register(moduleId,{...common,id:'files.read',title:'读取文本文件',description:'读取不超过 1 MiB 的 UTF-8 文本并返回保存版本标识。',
    inputSchema:{...input({path}),required:['path']},
    outputSchema:object({path:string,content:string,revision,size:integer,modifiedAt:string}),execute:readText});
  const write={kind:'write',permission:'files:write',executionPolicy:'user-files',exposure:{web:true,mcp:false},
    explain:'以普通服务账户执行；保存前检查文件版本，上传不覆盖同名文件。'};
  actions.register(moduleId,{...write,id:'files.write',title:'保存文本文件',description:'保存编辑后的 UTF-8 文本，最多 1 MiB。',
    inputSchema:{...input({path,content:{type:'string',maxLength:TEXT_LIMIT},revision}),required:['path','content','revision']},
    outputSchema:object({path:string,revision,size:integer,modifiedAt:string}),execute:writeText});
  actions.register(moduleId,{...write,id:'files.upload',title:'上传文件',description:'上传一个最多 8 MiB 的文件，不覆盖已有文件。',
    inputSchema:{...input({path,contentBase64:{type:'string',maxLength:Math.ceil(UPLOAD_LIMIT/3)*4}}),required:['path','contentBase64']},
    outputSchema:object({path:string,size:integer}),execute:uploadFile});
}
