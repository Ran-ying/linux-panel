import * as fs from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {dirname,join} from 'node:path';

const HEADER='# Linux Panel managed cron v1. Runs as linuxpanel. Do not edit.\n';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const digest=value=>createHash('sha256').update(value).digest('hex');
const ID=/^[a-f0-9-]{36}$/;
const FIELDS=[[0,59],[0,23],[1,31],[1,12],[0,7]];
function validField(value,[min,max]){
  return value.split(',').every(part=>{
    const match=/^(\*|\d{1,2}(?:-\d{1,2})?)(?:\/(\d{1,2}))?$/.exec(part);
    if(!match)return false;
    const span=match[1];
    const nums=span==='*'?[]:span.split('-').map(Number);
    return nums.every(n=>n>=min && n<=max) &&
      (nums.length<2 || nums[0]<=nums[1]) &&
      (!match[2] || (Number(match[2])>=1 && Number(match[2])<=max-min+1));
  });
}
export function validateCronTask(task){
  if(!task || typeof task!=='object' || Array.isArray(task) ||
      Object.keys(task).some(k=>!['id','name','expression','command','enabled'].includes(k)) ||
      (task.id!==undefined && (typeof task.id!=='string'||!ID.test(task.id))) ||
      typeof task.name!=='string' || !task.name.trim() || task.name.length>80 ||
      /[\r\n\0]/.test(task.name) ||
      typeof task.command!=='string' || !task.command.trim() || task.command.length>500 ||
      /[\r\n\0]/.test(task.command) || typeof task.enabled!=='boolean' ||
      typeof task.expression!=='string' || task.expression.length>100)
    throw fail('任务名称、命令或状态无效');
  const fields=task.expression.trim().split(/\s+/);
  if(fields.length!==5 || fields.some((field,i)=>!validField(field,FIELDS[i])))
    throw fail('Cron 表达式必须是有效的五字段数字规则（分 时 日 月 星期）');
  return {...task,name:task.name.trim(),expression:fields.join(' '),command:task.command.trim()};
}
const taskLine=task=>task.expression+' linuxpanel '+task.command;
function encode(tasks){
  return HEADER+tasks.map(task=>{
    const json=Buffer.from(JSON.stringify(task)).toString('base64url');
    const line=taskLine(task);
    return '# LP-TASK:'+json+'\n'+(task.enabled?line:'# DISABLED '+line)+'\n';
  }).join('');
}
function decode(content){
  if(!content)return [];
  if(!content.startsWith(HEADER))throw fail('已有 Cron 文件不属于 Linux Panel，拒绝覆盖',409);
  const rest=content.slice(HEADER.length);
  if(!rest)return [];
  const lines=rest.split('\n');if(lines.pop()!=='')throw fail('定时任务文件格式错误',409);
  if(lines.length%2!==0 || lines.length>200)throw fail('定时任务文件格式错误或数量超限',409);
  const ids=new Set(),tasks=[];
  for(let i=0;i<lines.length;i+=2){
    if(!lines[i].startsWith('# LP-TASK:'))throw fail('发现无法识别的 Cron 条目',409);
    let task;
    try{const bytes=Buffer.from(lines[i].slice(10),'base64url');
      if(bytes.toString('base64url')!==lines[i].slice(10))throw Error('Bad metadata');
      task=JSON.parse(bytes.toString('utf8'));
      task=validateCronTask(task);
    }catch{throw fail('定时任务元数据损坏',409);}
    if(!ID.test(task.id??'') || ids.has(task.id) ||
        lines[i+1]!== (task.enabled?taskLine(task):'# DISABLED '+taskLine(task)))
      throw fail('Cron 条目被修改或重复，拒绝覆盖',409);
    ids.add(task.id);tasks.push(task);
  }
  return tasks;
}
// Injection-friendly file path is solely for isolated unit tests; root handlers
// use the fixed path and require uid 0. No request can supply a path or username.
export function createCronOperations({path='/etc/cron.d/linux-panel',requireRoot=true}={}){
  if(requireRoot && path!=='/etc/cron.d/linux-panel')throw Error('Cannot redirect privileged cron path');
  const guard=()=>{
    if(requireRoot && process.getuid?.()!==0)throw fail('Cron 管理需要已启用的 root 执行器',503);
  };
  async function read(){
    guard();
    let bytes;
    try{
      const stat=await fs.lstat(path);
      if(!stat.isFile() || stat.isSymbolicLink() || stat.size>200000 ||
          (requireRoot && (stat.uid!==0 || (stat.mode&0o022)!==0)))
        throw fail('Cron 文件类型或所有权不安全',409);
      bytes=await fs.readFile(path);
    }catch(error){
      if(error.code==='ENOENT')bytes=Buffer.alloc(0);
      else throw error;
    }
    const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return {tasks:decode(content),revision:digest(bytes)};
  }
  async function write(tasks,previous){
    const next=encode(tasks);
    const dir=dirname(path);
    if(requireRoot){
      const stat=await fs.lstat(dir);
      if(!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==0 || (stat.mode&0o022))
        throw fail('Cron 配置目录不安全',503);
    }
    const temp=join(dir,'.linux-panel-'+randomUUID());
    try{
      await fs.writeFile(temp,next,{flag:'wx',mode:0o600});
      if(requireRoot)await fs.chown(temp,0,0);
      await fs.chmod(temp,0o644);
      if((await read()).revision!==previous)throw fail('任务已被其他进程修改，请刷新后重试',409);
      await fs.rename(temp,path);
    }finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    return digest(next);
  }
  // Serializes all writes through this executor, including a read-revision-write cycle.
  let gate=Promise.resolve();
  const locked=fn=>{
    const current=gate.then(fn);
    gate=current.catch(()=>{});
    return current;
  };
  const list=async()=>{const data=await read();return {...data,count:data.tasks.length};};
  const save=({task,revision})=>locked(async()=>{
    const data=await read();
    if(revision!==data.revision)throw fail('任务已经变化，请刷新后重试',409);
    task=validateCronTask(task);
    const id=task.id??randomUUID(),index=data.tasks.findIndex(t=>t.id===id);
    if(task.id && index===-1)throw fail('任务不存在，请刷新后重试',404);
    if(index===-1 && data.tasks.length>=100)throw fail('最多管理 100 个任务',413);
    const updated={...task,id};
    if(index===-1)data.tasks.push(updated);else data.tasks[index]=updated;
    return {id,revision:await write(data.tasks,revision)};
  });
  const remove=({id,revision})=>locked(async()=>{
    const data=await read();
    if(data.revision!==revision)throw fail('任务已经变化，请刷新后重试',409);
    const index=data.tasks.findIndex(task=>task.id===id);
    if(index===-1)throw fail('任务不存在',404);
    data.tasks.splice(index,1);
    return {id,revision:await write(data.tasks,revision)};
  });
  return {list,save,remove};
}