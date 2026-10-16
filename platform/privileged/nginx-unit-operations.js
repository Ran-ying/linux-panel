// Reviewed one-target repair for the immutable root executor's systemd sandbox.
// This module cannot accept a unit, path, command, capability or config text
// from callers. It never reads root instructions from the mutable Git checkout.
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const UNIT='linux-panel-privileged.service';
const UNIT_NAME='linux-panel-privileged.service';
const DROPIN='50-nginx-config-validation.conf';
const ADDR='AF_UNIX AF_INET AF_INET6';
const CAPS='CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_FOWNER CAP_CHOWN CAP_FSETID CAP_NET_BIND_SERVICE';
const CONTENT='[Service]\nRestrictAddressFamilies=\nRestrictAddressFamilies='+ADDR+
  '\nCapabilityBoundingSet=\nCapabilityBoundingSet='+CAPS+'\n';
const failure=(text,code=409)=>Object.assign(new Error(text),{statusCode:code});
const SAFE_ENV={PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'};
const safeFile=(stat,strict)=>stat.isFile()&&!stat.isSymbolicLink()&&(!strict||(stat.uid===0&&(stat.mode&0o022)===0));

export function createNginxUnitOperations({
  base='/etc/systemd/system',requireRoot=true,
  systemctl='/bin/systemctl',runner=exec
}={}){
  if(requireRoot&&(base!=='/etc/systemd/system'||systemctl!=='/bin/systemctl'))
    throw Error('Cannot redirect privileged systemd unit repair');
  const unitPath=join(base,UNIT),dir=join(base,UNIT_NAME+'.d'),target=join(dir,DROPIN);
  const guard=()=>{
    if(requireRoot&&process.getuid?.()!==0)throw failure('需要已启用的 root executor',503);
  };
  const run=async args=>{
    try{
      const r=await runner(systemctl,args,{timeout:10000,maxBuffer:16384,env:SAFE_ENV});
      return String(r.stdout??'').trim();
    }catch(error){
      throw failure('固定 systemctl 操作失败：'+String(error.stderr||error.message).slice(0,240),503);
    }
  };
  async function ensureTrustedUnit(){
    guard();
    const stat=await fs.lstat(unitPath);
    if(!safeFile(stat,requireRoot)||stat.size>8192)throw failure('特权服务单元权限或文件类型不安全');
    const raw=await fs.readFile(unitPath,'utf8');
    for(const assertion of [
      /^User=root$/m,/^Group=root$/m,
      /^ExecStart=\/opt\/node24\/bin\/node \/usr\/local\/lib\/linux-panel-privileged\/current\/server\.js$/m,
      /^NoNewPrivileges=true$/m,
      /^RestrictAddressFamilies=AF_UNIX(?: AF_INET AF_INET6)?$/m,
      /^CapabilityBoundingSet=CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_FOWNER CAP_CHOWN CAP_FSETID(?: CAP_NET_BIND_SERVICE)?$/m
    ]){
      if(!assertion.test(raw))throw failure('root unit 不符合已审核安装结构，拒绝修复',409);
    }
    const baseStat=await fs.lstat(base);
    if(!baseStat.isDirectory()||baseStat.isSymbolicLink()||(requireRoot&&(baseStat.uid!==0||(baseStat.mode&0o022))))
      throw failure('systemd 配置目录不安全',409);
  }
  async function existingDropin(){
    try{
      const st=await fs.lstat(dir);
      if(!st.isDirectory()||st.isSymbolicLink()||(requireRoot&&(st.uid!==0||(st.mode&0o022))))
        throw failure('已有 systemd drop-in 目录不安全');
      const f=await fs.lstat(target).catch(error=>{
        if(error.code==='ENOENT')return null;
        throw error;
      });
      if(!f)return null;
      if(!safeFile(f,requireRoot)||f.size>4096)throw failure('拒绝覆盖未知 drop-in');
      if(await fs.readFile(target,'utf8')!==CONTENT)throw failure('已有不同内容的同名 drop-in，拒绝覆盖');
      return true;
    }catch(error){
      if(error.code==='ENOENT')return null;
      throw error;
    }
  }
  async function effective(){
    const addresses=await run(['show','-P','RestrictAddressFamilies',UNIT_NAME]);
    const capabilities=await run(['show','-P','CapabilityBoundingSet',UNIT_NAME]);
    return {addresses,capabilities,ready:
      addresses.includes('AF_INET')&&addresses.includes('AF_INET6')&&
      capabilities.toLowerCase().includes('cap_net_bind_service')};
  }
  let gate=Promise.resolve();
  const serial=fn=>{const current=gate.then(fn);gate=current.catch(()=>{});return current;};
  async function repair({mode,confirmation}){
    return serial(async()=>{
      if(confirmation!=='APPLY_REVIEWED_NGINX_UNIT')throw failure('必须明确确认固定 systemd 修复');
      await ensureTrustedUnit();
      if(mode==='status'){
        const state=await effective();
        return {status:state.ready?'已满足 Nginx 校验权限':'Nginx 校验权限尚未激活',
          ready:state.ready,restartScheduled:false};
      }
      if(mode==='stage'){
        const state=await effective();
        if(state.ready)return {status:'当前 systemd 单元已具备所需权限',ready:true,restartScheduled:false};
        const old=await existingDropin();
        let createdDirectory=false,createdFile=false,tmp=null;
        try{
          if(old===null){
            let dirStat;
            try{dirStat=await fs.lstat(dir);}catch(error){if(error.code!=='ENOENT')throw error;}
            if(!dirStat){await fs.mkdir(dir,{mode:0o755});createdDirectory=true;}
            else if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||(requireRoot&&(dirStat.uid!==0||(dirStat.mode&0o022))))
              throw failure('drop-in 目录不安全');
            tmp=join(dir,'.nginx-compat-'+randomUUID());
            await fs.writeFile(tmp,CONTENT,{flag:'wx',mode:0o600});
            await fs.chmod(tmp,0o644);
            await fs.rename(tmp,target);createdFile=true;tmp=null;
          }
          await run(['daemon-reload']);
          const after=await effective();
          if(!after.ready)throw failure('systemd 重载后仍未获得预期权限',503);
          return {status:'已写入固定权限覆盖文件并重载 systemd；还需重启特权服务',ready:true,restartScheduled:false};
        }catch(error){
          if(createdFile)await fs.unlink(target).catch(()=>{});
          if(tmp)await fs.unlink(tmp).catch(()=>{});
          if(createdDirectory)await fs.rmdir(dir).catch(()=>{});
          // Restore the old loaded unit after any failed staging attempt.
          await run(['daemon-reload']).catch(()=>{});
          throw error;
        }
      }
      if(mode==='restart'){
        const state=await effective();
        if(!state.ready)throw failure('需要先成功暂存并验证固定权限覆盖文件',409);
        // Fixed self-restart. The socket may close before its response reaches
        // the client: a caller must poll the service and run nginx.check again.
        await run(['--no-block','restart',UNIT_NAME]);
        return {status:'已排队重启特权执行服务；请重新连接验证',ready:true,restartScheduled:true};
      }
      throw failure('未知修复阶段',400);
    });
  }
  return {repair};
}
