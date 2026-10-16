// Fixed reviewed root Actions: only manage Linux Panel's dedicated /etc/cron.d file.
// Every cron entry has the static run-as account linuxpanel, never root.
const string=(maxLength)=>({type:'string',minLength:1,maxLength});
const task={type:'object',additionalProperties:false,
  required:['name','expression','command','enabled'],
  properties:{id:{type:'string',pattern:'^[a-f0-9-]{36}$'},name:string(80),
    expression:string(100),command:string(500),enabled:{type:'boolean'}}};
const revision={type:'string',pattern:'^[a-f0-9]{64}
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const systemTask=object({
  id:revision,revision,sourceType:string(40),source:string(300),name:string(150),
  owner:{type:'string',maxLength:120},expression:{type:'string',maxLength:150},
  command:{type:'string',maxLength:3000},enabled:{type:'boolean'},editable:{type:'boolean'},
  control:{type:'string',enum:['cron','timer','none']},nextRun:{type:'string',maxLength:60},
  detail:{type:'string',maxLength:300},line:{type:'integer',minimum:0},raw:{type:'string',maxLength:3000}
});
export const CRON_CONTRACTS={
  list:{title:'定时任务',description:'读取 Linux Panel 管理的 Cron 任务。',
    inputSchema:object({}),
    outputSchema:{...object({tasks:{type:'array',items:{...task,required:[...task.required,'id']}},revision,count:{type:'integer',minimum:0},systemTasks:{type:'array',items:systemTask},systemCount:{type:'integer',minimum:0},systemWarnings:{type:'array',items:{type:'string',maxLength:400}}},['tasks','revision','count'])}},
  save:{title:'保存定时任务',description:'创建、编辑或启停定时任务。',
    inputSchema:object({revision,task}),
    outputSchema:object({id:string(36),revision})},
  systemSet:{title:'管理现有系统任务',description:'对系统已有 Cron 条目进行版本化编辑、启停或删除；systemd timer 只可启停。',
    inputSchema:object({id:revision,revision,operation:{type:'string',enum:['enable','disable','edit','remove']},expression:string(100),command:string(2000)},['id','revision','operation']),
    outputSchema:object({id:revision,revision})},
  remove:{title:'删除定时任务',description:'删除指定的 Linux Panel Cron 任务。',
    inputSchema:object({id:string(36),revision}),
    outputSchema:object({id:string(36),revision})}
};};

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