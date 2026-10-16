// Fixed reviewed root Actions: only manage Linux Panel's dedicated /etc/cron.d file.
// Every cron entry has the static run-as account linuxpanel, never root.
const string=(maxLength)=>({type:'string',minLength:1,maxLength});
const task={type:'object',additionalProperties:false,
  required:['name','expression','command','enabled'],
  properties:{id:{type:'string',pattern:'^[a-f0-9-]{36}$'},name:string(80),
    expression:string(100),command:string(500),enabled:{type:'boolean'}}};
const revision={type:'string',pattern:'^[a-f0-9]{64}$'};
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
export const CRON_CONTRACTS={
  list:{title:'定时任务',description:'读取 Linux Panel 管理的 Cron 任务。',
    inputSchema:object({}),
    outputSchema:object({tasks:{type:'array',items:{...task,required:[...task.required,'id']}},revision,count:{type:'integer',minimum:0}})},
  save:{title:'保存定时任务',description:'创建、编辑或启停定时任务。',
    inputSchema:object({revision,task}),
    outputSchema:object({id:string(36),revision})},
  remove:{title:'删除定时任务',description:'删除指定的 Linux Panel Cron 任务。',
    inputSchema:object({id:string(36),revision}),
    outputSchema:object({id:string(36),revision})}
};