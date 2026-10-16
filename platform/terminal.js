import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isUserShellAction} from '../core/action-policy.js';

const failure=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function requireOrdinaryTerminal() {
  if(process.platform!=='linux')throw failure('终端仅支持 Linux',503);
  if(process.getuid?.()===0)throw failure('终端必须以面板普通用户运行',503);
}
export async function executeShell({command,timeoutSeconds=30}) {
  requireOrdinaryTerminal();
  return new Promise((resolve,reject)=>{
    const started=performance.now(),limit=256*1024;
    let stdout=[],stderr=[],bytes=0,truncated=false,timedOut=false,killTimer;
    const child=spawn('/bin/sh',['-c',command],{
      detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TERM:'xterm-256color'}
    });
    const kill=signal=>{try{process.kill(-child.pid,signal);}catch{}};
    const timer=setTimeout(()=>{
      timedOut=true;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),1000);
    },timeoutSeconds*1000);
    const collect=target=>chunk=>{
      const available=Math.max(0,limit-bytes);
      if(available)target.push(chunk.subarray(0,available));
      bytes+=chunk.length;
      if(bytes>limit){truncated=true;kill('SIGKILL');}
    };
    child.stdout.on('data',collect(stdout));child.stderr.on('data',collect(stderr));
    child.once('error',()=>{clearTimeout(timer);clearTimeout(killTimer);reject(failure('无法启动终端命令',503));});
    child.once('close',(code,signal)=>{
      clearTimeout(timer);clearTimeout(killTimer);
      resolve({stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8'),
        exitCode:code,signal:signal ?? null,timedOut,truncated,durationMs:Math.round(performance.now()-started)});
    });
  });
}

/** Panel-owned PTY lifecycle; command text/output never enters persistent state. */
export class TerminalSessions {
  constructor({registry,auth,presentations,spawnPty}){
    this.registry=registry;this.auth=auth;this.presentations=presentations;this.sessions=new Map();
    this.spawnPty=spawnPty ?? ((cols,rows)=>spawn('python3',['-u',fileURLToPath(new URL('./terminal-pty.py',import.meta.url)),String(cols),String(rows)],{
      stdio:['pipe','pipe','pipe'],env:{...process.env,TERM:'xterm-256color',HISTFILE:'/dev/null',PS1:'$ '}
    }));
    this.sweeper=setInterval(()=>void this.sweep(),5000);this.sweeper.unref();
  }
  async open(identity,token,{actionId,cols=80,rows=24}={}){
    const action=this.registry.get(actionId);
    if(!isUserShellAction(action) || action.exposure?.web!==true ||
      !this.presentations.some(p=>p.actionId===actionId && p.console==='terminal'))
      throw failure('终端能力不可用',404);
    this.auth.requirePermission(identity,action.permission);
    requireOrdinaryTerminal();
    if(!Number.isInteger(cols)||cols<20||cols>300||!Number.isInteger(rows)||rows<5||rows>100)
      throw failure('终端尺寸无效');
    if(this.sessions.size>=2)throw failure('最多同时连接两个终端，请先断开已有连接',429);
    const id=randomBytes(24).toString('base64url'),now=Date.now();
    const child=this.spawnPty(cols,rows);
    const session={id,child,userId:identity.user.id,sessionId:identity.session.id,token,
      actionId,createdAt:now,touchedAt:now,seq:0,chunks:[],bytes:0,closed:false};
    this.sessions.set(id,session);
    let pending='';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      pending+=chunk;
      let end;
      while((end=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,end);pending=pending.slice(end+1);
        try{
          const event=JSON.parse(line);
          if(typeof event.data==='string'){
            session.chunks.push({seq:++session.seq,data:event.data});
            session.bytes+=Buffer.byteLength(event.data);
            while(session.bytes>512*1024 && session.chunks.length>1)
              session.bytes-=Buffer.byteLength(session.chunks.shift().data);
          }
        }catch{this.stop(session);}
      }
    });
    child.stderr.resume();
    child.on('error',()=>{session.closed=true;});
    child.on('close',()=>{session.closed=true;});
    child.stdin.on('error',()=>{session.closed=true;});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(failure('无法启动交互终端，请检查 Python 3',503)));}).catch(error=>{this.sessions.delete(id);throw error;});
    return {id};
  }
  get(identity,id){
    const session=this.sessions.get(id);
    if(!session || session.userId!==identity.user.id || session.sessionId!==identity.session.id)
      throw failure('终端会话不存在',404);
    return session;
  }
  output(identity,id,after=0){
    const session=this.get(identity,id);
    if(!Number.isSafeInteger(after)||after<0)throw failure('输出游标无效');
    const result={chunks:session.chunks.filter(c=>c.seq>after),cursor:session.seq,closed:session.closed,
      lost:session.chunks.length>0 && after<session.chunks[0].seq-1};
    if(session.closed)this.sessions.delete(id);
    return result;
  }
  input(identity,id,data){
    const session=this.get(identity,id);
    if(session.closed)throw failure('终端已断开',409);
    if(typeof data!=='string'||Buffer.byteLength(data)>16384)throw failure('终端输入过长');
    session.touchedAt=Date.now();
    session.child.stdin.write(JSON.stringify({data:Buffer.from(data).toString('base64')})+'\n');
  }
  resize(identity,id,cols,rows){
    const session=this.get(identity,id);
    if(!Number.isInteger(cols)||cols<20||cols>300||!Number.isInteger(rows)||rows<5||rows>100)
      throw failure('终端尺寸无效');
    if(!session.closed)session.child.stdin.write(JSON.stringify({cols,rows})+'\n');
  }
  stop(session){
    if(session.closed)return;
    session.closed=true;session.child.stdin.end();session.child.kill('SIGTERM');
    const timer=setTimeout(()=>{try{session.child.kill('SIGKILL');}catch{}},2000);timer.unref();
  }
  close(identity,id){const session=this.get(identity,id);this.stop(session);this.sessions.delete(id);}
  async sweep(){
    for(const session of this.sessions.values()){
      let valid=true;try{await this.auth.authenticate(session.token);}catch{valid=false;}
      if(!valid || Date.now()-session.touchedAt>10*60*1000 || Date.now()-session.createdAt>60*60*1000){
        this.stop(session);this.sessions.delete(session.id);
      }
    }
  }
  shutdown(){clearInterval(this.sweeper);for(const session of this.sessions.values())this.stop(session);this.sessions.clear();}
}
