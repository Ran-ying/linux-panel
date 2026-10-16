// Pure shared contracts, installed with the reviewed root handlers. No runtime imports from module/data directories.
const path={type:'string',minLength:1,maxLength:4096};
const string={type:'string'},integer={type:'integer',minimum:0};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const revision={type:'string',pattern:'^[a-f0-9]{64}$'};
export const FILE_CONTRACTS={
  list:{title:'文件浏览',description:'分页读取文件、目录大小、权限与所有者。',
    inputSchema:object({path,offset:integer,limit:{type:'integer',minimum:1,maximum:500}},[]),
    outputSchema:object({path:string,parent:{type:['string','null']},accessMode:{type:'string',enum:['root','user']},
      writeAccess:{type:'string',enum:['allowed','readonly','denied']},total:integer,nextOffset:{type:['integer','null']},
      entries:{type:'array',items:object({name:string,type:{type:'string',enum:['directory','file','other']},symlink:{type:'boolean'},
        size:{type:['integer','null'],minimum:0},sizeComplete:{type:'boolean'},permissions:string,owner:string,modifiedAt:string})}})},
  read:{title:'读取文本文件',description:'读取不超过 1 MiB 的 UTF-8 文本并返回版本标识。',inputSchema:object({path}),
    outputSchema:object({path:string,content:string,revision,size:integer,modifiedAt:string})},
  write:{title:'保存文本文件',description:'保存不超过 1 MiB 的 UTF-8 文本，检查原版本并保留权限及属主。',
    inputSchema:object({path,content:{type:'string',maxLength:1024*1024},revision}),outputSchema:object({path:string,revision,size:integer,modifiedAt:string})},
  upload:{title:'上传文件',description:'上传不超过 8 MiB 的文件，排他创建，不覆盖同名文件。',
    inputSchema:object({path,contentBase64:{type:'string',maxLength:Math.ceil(8*1024*1024/3)*4}}),outputSchema:object({path:string,size:integer})},
  create:{title:'新建文件或目录',description:'新建空文件或文件夹，同名失败。',inputSchema:object({path,type:{type:'string',enum:['file','directory']}}),outputSchema:object({path:string})},
  rename:{title:'重命名文件或目录',description:'同一目录内重命名并检查同名冲突。',inputSchema:object({path,newPath:path}),outputSchema:object({path:string})},
  delete:{title:'删除文件或目录',description:'删除文件、链接或目录；非空目录递归删除，无法撤销。',inputSchema:object({path}),outputSchema:object({path:string})},
  chmod:{title:'修改文件权限',description:'设置三或四位八进制权限；不跟随符号链接。',
    inputSchema:object({path,mode:{type:'string',pattern:'^[0-7]{3,4}$'}}),outputSchema:object({path:string})},
  chown:{title:'修改文件属主与用户组',description:'接收用户名/UID、组名/GID，至少提供一项；链接修改链接本身。',
    inputSchema:{...object({path,owner:{type:'string',minLength:1,maxLength:128},group:{type:'string',minLength:1,maxLength:128}},['path']),anyOf:[{required:['owner']},{required:['group']}]},outputSchema:object({path:string})}
};
