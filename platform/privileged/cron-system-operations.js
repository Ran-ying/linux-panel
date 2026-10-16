// System-wide scheduled-task inventory and reviewed per-entry management.
// No caller-supplied filesystem paths or commands are ever passed to a shell.
import * as fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,basename,dirname} from 'node:path';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFileCallback);
const sha=s=>createHash('sha256').update(s).digest('hex');
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const safeName=s=>typeof s==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,110}$/.test(s)&&s!=='.'&&s!=='..';
const safeUser=s=>typeof s==='string'&&/^[a-z_][a-z0-9_-]*\$?$/.test(s);
const ID=/^[a-f0-9]{64}$/;
const MACROS=new Set(['@reboot','@yearly','@annually','@monthly','@weekly','@daily','@midnight','@hourly']);
const cronTime=t=>/^[\d*,/-]+$/.test(t);
function parseLine(raw,kind){
  const panelDisabled=raw.startsWith('# LP-OFF ');
  const source=panelDisabled?raw.slice(9):raw;
  const line=source.trim();
  if(!line || line.startsWith('#') || line.includes('\0'))return null;
  const parts=line.split(/\s+/);
  const macro=MACROS.has(parts[0]);
  const count=macro?1:5;
  if(parts.length<count+(kind==='user'?1:2))return null;
  if(!macro && (!parts.slice(0,5).every(cronTime)))return null;
  const expression=parts.slice(0,count).join(' ');
  const user=kind==='user'?'':parts[count];
  if(kind!=='user'&&!safeUser(user))return null;
  const cmd=parts.slice(count+(kind==='user'?0:1)).join(' ');
  if(!cmd)return null;
  return {expression,command:cmd,user,enabled:!panelDisabled,editable:!macro};
}
function cronEntry({kind,path,username,revision,index,line,parsed}){
  const id=sha(['cron',kind,path,username??'',index,line].join('\0'));
  const sourceType=kind==='user'?'user-crontab':kind==='master'?'system-crontab':'cron.d';
  return {id,revision,sourceType,source:kind==='user'?'crontab:'+username:path,
    name:kind==='user'?username:basename(path),owner:kind==='user'?username:parsed.user,
    expression:parsed.expression,command:parsed.command,enabled:parsed.enabled,
    editable:parsed.editable,control:parsed.editable?'cron':'none',nextRun:'',
    detail:kind==='user'?'用户 Crontab':kind==='master'?'系统 Crontab':'系统 Cron 配置',
    line:index,raw:line};
}
const limited=(values,max)=>values.length<=max?values:values.slice(0,max);
const runFixed=async (binary,args,timeout=8000)=>{
  const result=await run(binary,args,{timeout,maxBuffer:1024*1024,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C'}});
  return result.stdout;
};
export function createSystemCronOperations({etc='/etc',spool='/var/spool/cron/crontabs',
  requireRoot=true,execute=runFixed}={}){
  if(requireRoot&&(etc!=='/etc'||spool!=='/var/spool/cron/crontabs'))
    throw Error('System Cron root handler paths are fixed');
  const guard=()=>{if(requireRoot&&process.getuid?.()!==0)throw fail('需要 root 执行器',503);};
  const readSafe=async(path,{spoolFile=false}={})=>{
    const s=await fs.lstat(path);
    if(!s.isFile()||s.isSymbolicLink()||s.size>131072||s.mode&0o022||
        (requireRoot&&!spoolFile&&s.uid!==0))throw fail('不安全的定时任务配置',409);
    return {content:await fs.readFile(path,'utf8'),stat:s};
  };
  const warnings=[],readErrors=[];
  async function enumerate(){
    guard();
    const tasks=[],issues=[];
    const addWarning=(prefix,err)=>{if(issues.length<60)issues.push(prefix+': '+String(err.message??err).slice(0,160));};
    const addFile=async(kind,path,username)=>{
      try {
        const data=await readSafe(path,{spoolFile:kind==='user'}),revision=sha(data.content);
        data.content.split('\n').forEach((line,index)=>{
          const parsed=parseLine(line,kind);
          if(parsed&&tasks.length<700)tasks.push(cronEntry({kind,path,username,revision,index,line,parsed}));
        });
      }catch(e){if(e.code!=='ENOENT')addWarning(path,e);}
    };
    await addFile('master',join(etc,'crontab'));
    try{
      const entries=await fs.readdir(join(etc,'cron.d'),{withFileTypes:true});
      for(const file of entries.slice(0,200)){
        if(!safeName(file.name)||file.name.startsWith('.')||file.name==='linux-panel'||!file.isFile())continue;
        await addFile('dropin',join(etc,'cron.d',file.name));
      }
    }catch(e){if(e.code!=='ENOENT')addWarning('cron.d',e);}
    try{
      const entries=await fs.readdir(spool,{withFileTypes:true});
      for(const file of entries.slice(0,200)){
        if(!safeUser(file.name)||!file.isFile())continue;
        await addFile('user',join(spool,file.name),file.name);
      }
    }catch(e){if(e.code!=='ENOENT')addWarning('用户 crontab',e);}
    for(const frequency of ['hourly','daily','weekly','monthly']){
      const dir=join(etc,'cron.'+frequency);
      try{
        for(const file of (await fs.readdir(dir,{withFileTypes:true})).slice(0,200)){
          if(!safeName(file.name)||file.name.startsWith('.')||!file.isFile())continue;
          const path=join(dir,file.name);
          try{
            const stat=await fs.lstat(path);
            if(!stat.isFile()||stat.isSymbolicLink())continue;
            const executable=(stat.mode&0o111)!==0;
            tasks.push({id:sha('periodic\0'+path),revision:sha([stat.mode,stat.mtimeMs,stat.size].join(':')),
              sourceType:'periodic',source:path,name:file.name,owner:'root',
              expression:'cron.'+frequency,command:path,enabled:executable,editable:false,
              control:'none',nextRun:'',detail:'由 run-parts/anacron 调用；请在文件管理中修改',line:0,raw:''});
          }catch(e){addWarning(path,e);}
        }
      }catch(e){if(e.code!=='ENOENT')addWarning(dir,e);}
    }
    // anacron has its own days/delay/job-id schedule syntax.
    try{
      const data=await readSafe(join(etc,'anacrontab'));
      for(const [index,raw] of data.content.split('\n').entries()){
        const line=raw.trim();
        if(!line||line.startsWith('#')||line.includes('='))continue;
        const match=/^(@monthly|[1-9]\d*)\s+(\d+)\s+([A-Za-z0-9_-]+)\s+(.+)$/.exec(line);
        if(!match)continue;
        tasks.push({id:sha('anacron\0'+index+'\0'+raw),revision:sha(data.content),
          sourceType:'anacron',source:join(etc,'anacrontab'),name:match[3],owner:'root',
          expression:match[1]+' / delay '+match[2]+' min',command:match[4],enabled:true,
          editable:false,control:'none',nextRun:'',detail:'anacron 定期任务；请在文件管理中修改',
          line:index,raw});
      }
    }catch(e){if(e.code!=='ENOENT')addWarning('anacron',e);}
    // Optional at queues contain one-shot rather than recurring jobs.
    try{
      const data=await execute('/usr/bin/atq',[]);
      for(const line of data.split('\n').slice(0,150)){
        const match=/^(\d+)\s+(.+?)\s+([a-z])\s+(\S+)\s*$/.exec(line.trim());
        if(!match)continue;
        tasks.push({id:sha('at\0'+match[1]),revision:sha(data),sourceType:'at-job',
          source:'atq',name:'at #'+match[1],owner:match[4],expression:match[2],
          command:'',enabled:true,editable:false,control:'none',nextRun:'',
          detail:'单次 at 任务；目前只读',line:0,raw:''});
      }
    }catch(e){if(e.code!=='ENOENT')addWarning('atq',e);}
    try{
      const timerData=JSON.parse(await execute('/usr/bin/systemctl',['list-timers','--all','--output=json','--no-pager']));
      const fileData=JSON.parse(await execute('/usr/bin/systemctl',['list-unit-files','--type=timer','--all','--output=json','--no-pager']));
      const live=new Map(timerData.filter(x=>safeName(x.unit)).map(x=>[x.unit,x]));
      const unique=new Set();
      for(const entry of fileData.slice(0,400)){
        const unit=entry.unit_file,info=live.get(unit);
        if(typeof unit!=='string'||!/^[A-Za-z0-9_.@-]+\.timer$/.test(unit)||unit.includes('..'))continue;
        unique.add(unit);
        const state=String(entry.state??'unknown');
        const next=info?.next?new Date(Math.floor(info.next/1000)).toISOString():'';
        tasks.push({id:sha('timer\0'+unit),revision:sha(unit+'\0'+state),sourceType:'systemd-timer',
          source:unit,name:unit,owner:'systemd',expression:'systemd',command:String(info?.activates??''),
          enabled:state==='enabled'||state==='enabled-runtime',editable:false,
          control:['enabled','disabled','enabled-runtime'].includes(state)&&!unit.includes('@.')?'timer':'none',
          nextRun:next,detail:'UnitFileState='+state,line:0,raw:''});
      }
      for(const [unit,info] of live){
        if(unique.has(unit)||!unit.endsWith('.timer'))continue;
        tasks.push({id:sha('timer\0'+unit),revision:sha(unit+'\0active'),sourceType:'systemd-timer',
          source:unit,name:unit,owner:'systemd',expression:'systemd',command:String(info.activates??''),
          enabled:true,editable:false,control:'none',nextRun:info.next?new Date(Math.floor(info.next/1000)).toISOString():'',
          detail:'运行中，但未在 unit-file 列表中；仅查看',line:0,raw:''});
      }
    }catch(e){addWarning('systemd timers',e);}
    return {systemTasks:limited(tasks,800),systemCount:Math.min(tasks.length,800),systemWarnings:issues};
  }
  // Only specific, already-enumerated Cron records can be modified.
  // No user-controlled path, UID, unit file, or shell command is accepted.
  let queue=Promise.resolve();
  const serialize=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  async function set({id,revision,operation,expression,command}){
    return serialize(async()=>{
      guard();
      if(!ID.test(id)||!ID.test(revision))throw fail('任务标识不合法');
      const {systemTasks}=await enumerate();
      const record=systemTasks.find(t=>t.id===id);
      if(!record)throw fail('任务已不存在，请刷新',404);
      if(revision!==record.revision)throw fail('定时任务已变化，请刷新',409);
      if(!['enable','disable','edit','remove'].includes(operation))throw fail('不支持的操作');
      if(record.control==='timer'){
        if(operation!=='enable'&&operation!=='disable')throw fail('systemd timer 仅提供启停，请使用 systemd 单元配置编辑调度',400);
        if(operation==='enable'&&record.enabled||operation==='disable'&&!record.enabled)
          return {id,revision};
        await execute('/usr/bin/systemctl',[operation==='enable'?'enable':'disable','--now',record.source],15000);
        const next=await enumerate();
        const updated=next.systemTasks.find(t=>t.id===id);
        if(!updated||updated.enabled===(operation==='disable'))throw fail('systemd timer 修改后未达到预期状态',503);
        return {id,revision:updated.revision};
      }
      if(record.control!=='cron')throw fail('此类任务目前只支持查看，请通过对应的系统管理方式修改',403);
      if(operation==='enable'&&record.enabled||operation==='disable'&&!record.enabled)return {id,revision};
      const kind=record.sourceType==='user-crontab'?'user':record.sourceType==='system-crontab'?'master':'dropin';
      const path=kind==='user'?join(spool,record.owner):record.source;
      const current=await readSafe(path,{spoolFile:kind==='user'});
      if(sha(current.content)!==record.revision)throw fail('文件内容已变化，请刷新',409);
      const lines=current.content.split('\n');
      if(lines[record.line]!==record.raw)throw fail('定时任务行已变化，请刷新',409);
      if(operation==='remove')lines.splice(record.line,1);
      else if(operation==='disable')lines[record.line]='# LP-OFF '+record.raw;
      else if(operation==='enable')lines[record.line]=record.raw.slice(9);
      else{
        if(typeof expression!=='string'||typeof command!=='string'||expression.length>100||
            command.length>2000||/[\r\n\0]/.test(expression+command))
          throw fail('调度或命令不合法');
        const fields=expression.trim().split(/\s+/);
        if(fields.length!==5||!fields.every(cronTime)||!command.trim())throw fail('仅允许五字段 Cron 任务');
        const updated=expression.trim()+' '+(kind==='user'?'':record.owner+' ')+command.trim();
        lines[record.line]=record.enabled?updated:'# LP-OFF '+updated;
      }
      const next=lines.join('\n');
      if(next===current.content)return {id,revision:sha(next)};
      if(kind==='user'){
        // crontab CLI is the official spool writer; direct spool edits are forbidden.
        const scratch=join('/tmp','lp-crontab-'+randomUUID());
        try{
          await fs.writeFile(scratch,next,{flag:'wx',mode:0o600});
          if((await readSafe(path,{spoolFile:true})).content!==current.content)throw fail('用户 crontab 已变化',409);
          await execute('/usr/bin/crontab',['-u',record.owner,scratch],12000);
        }finally{await fs.unlink(scratch).catch(()=>{});}
      }else{
        const stat=current.stat,temporary=join(dirname(path),'.lp-cron-'+randomUUID());
        try{
          await fs.writeFile(temporary,next,{flag:'wx',mode:0o600});
          await fs.chown(temporary,stat.uid,stat.gid);
          await fs.chmod(temporary,stat.mode&0o777);
          if((await readSafe(path)).content!==current.content)throw fail('Cron 配置已变化',409);
          await fs.rename(temporary,path);
        }finally{await fs.unlink(temporary).catch(()=>{});}
      }
      return {id,revision:sha(next)};
    });
  }
  return {enumerate,set};
}
