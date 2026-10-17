import * as fs from 'node:fs/promises';
import {createHash,randomUUID,X509Certificate} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve,sep,dirname} from 'node:path';
import {networkInterfaces} from 'node:os';
import {createNginxCertbotCleanup} from './nginx-certbot-cleanup.js';

const exec=promisify(execFile);
const MAX_FILES=200, MAX_BYTES=65536;
const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function safeName(name){
  if(typeof name!=='string'|| !NAME.test(name)||name==='.'||name==='..')
    throw fail('网站配置名称不合法');
  return name;
}
const within=(path,base)=>path===base || path.startsWith(base+sep);
const strictBytes=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);

/** Bounded, advisory extraction: do not treat it as nginx -T or parse directives as commands. */
export function parseNginxDirectives(content){
  let clean='',quote='',escape=false,comment=false;
  for(const ch of content){
    if(ch==='\n'){comment=false;clean+='\n';continue;}
    if(comment)continue;
    if(escape){clean+=ch;escape=false;continue;}
    if(ch==='\\'){clean+=ch;escape=true;continue;}
    if(quote){clean+=ch;if(ch===quote)quote='';continue;}
    if(ch==='"'||ch==="'"){quote=ch;clean+=ch;continue;}
    if(ch==='#'){comment=true;continue;}
    clean+=ch;
  }
  const collect=key=>{
    const regex=new RegExp('(?:^|[;{}\\n])\\s*'+key+'\\s+([^;{}]{1,1000});','g');
    return [...new Set([...clean.matchAll(regex)].flatMap(m=>m[1].trim().split(/\s+/).filter(Boolean)))]
      .slice(0,16).join(', ').slice(0,350);
  };
  return {serverNames:collect('server_name'),listens:collect('listen')};
}

export function createNginxOperations({
  root='/etc/nginx',requireRoot=true,
  nginx='/usr/sbin/nginx',systemctl='/bin/systemctl',runner=exec,
  certificateRoot='/etc/letsencrypt/live',certbot='/usr/bin/certbot',
  renewalRoot=resolve(certificateRoot,'../renewal')
}={}){
  if(requireRoot && (root!=='/etc/nginx'||nginx!=='/usr/sbin/nginx'||
    systemctl!=='/bin/systemctl'||certificateRoot!=='/etc/letsencrypt/live'||
    certbot!=='/usr/bin/certbot'||renewalRoot!=='/etc/letsencrypt/renewal'))
    throw Error('Cannot redirect privileged Nginx paths');
  const base=resolve(root),available=join(base,'sites-available'),enabled=join(base,'sites-enabled');
  const cleanup=createNginxCertbotCleanup({nginxRoot:root,certificateRoot,
    renewalRoot,nginx,certbot,runner,requireRoot});
  const guard=()=>{
    if(requireRoot&&process.getuid?.()!==0)throw fail('Nginx 操作需要独立 root 执行器',503);
  };
  async function listenAddresses(){
    const addresses=[{address:'0.0.0.0',interface:'所有 IPv4 接口'},
      {address:'127.0.0.1',interface:'本机回环'}];
    const seen=new Set(addresses.map(item=>item.address));
    for(const [iface,items] of Object.entries(networkInterfaces())){
      for(const item of items||[]){
        if(item.family!=='IPv4'||!item.address||seen.has(item.address))continue;
        // These are addresses currently assigned to this Nginx host, not
        // arbitrary externally advertised DNS or public IPv4 candidates.
        seen.add(item.address);
        addresses.push({address:item.address,interface:iface.slice(0,100)});
      }
    }
    return {addresses:addresses.slice(0,64)};
  }
  async function checkDirectories(){
    guard();
    for(const dir of [base,available,enabled]){
      let stat;
      try{stat=await fs.lstat(dir);}catch(error){
        if(error.code==='ENOENT')throw fail('站点目录不存在：'+dir,503);
        throw error;
      }
      if(!stat.isDirectory()||stat.isSymbolicLink()||
        (requireRoot&&(stat.uid!==0 || (stat.mode&0o022)!==0)))
        throw fail('Nginx 目录不安全或无效',503);
    }
  }
  const pathFor=name=>join(available,safeName(name));
  async function oldLink(name){
    const path=join(enabled,safeName(name));
    let st;
    try{st=await fs.lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!st.isSymbolicLink())throw fail('启用目录存在非符号链接，拒绝接管',409);
    const target=await fs.readlink(path);
    if(resolve(enabled,target)!==pathFor(name))throw fail('同名启用链接指向其它配置，拒绝操作',409);
    return target;
  }
  async function existing(name){
    const path=pathFor(name);
    let st;
    try{st=await fs.lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES ||
       (requireRoot&&(st.uid!==0 || (st.mode&0o022)!==0)))
      throw fail('站点文件类型、大小或权限不允许管理',409);
    const bytes=await fs.readFile(path);
    if(bytes.length>MAX_BYTES)throw fail('站点文件过大',413);
    let content;
    try{content=strictBytes(bytes);}catch{throw fail('仅支持有效 UTF-8 配置',415);}
    const link=await oldLink(name);
    return {bytes,content,stat:st,link,revision:hash(Buffer.concat([bytes,Buffer.from(link===null?'0':'1')]))};
  }
  async function atomicReplace(path,content,stats){
    const tmp=join(available,'.linux-panel-'+randomUUID());
    let handle;
    try{
      handle=await fs.open(tmp,'wx',0o600);
      await handle.writeFile(content);
      await handle.sync();
      await handle.close();handle=null;
      if(stats)await fs.chown(tmp,stats.uid,stats.gid);
      await fs.chmod(tmp,stats?stats.mode&0o7777:0o644);
      await fs.rename(tmp,path);
    }finally{
      if(handle)await handle.close().catch(()=>{});
      await fs.unlink(tmp).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  }
  async function runBinary(command,args,timeout=10000){
    try{
      const {stdout='',stderr=''}=await runner(command,args,{timeout,maxBuffer:64*1024,
        env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}});
      return {ok:true,exitCode:0,output:(stderr+'\n'+stdout).trim().slice(0,4000)};
    }catch(error){
      return {ok:false,exitCode:Number.isInteger(error.code)?error.code:null,
        output:String(error.stderr||error.stdout||error.message).slice(0,4000)};
    }
  }
  async function check(){
    guard();
    const tested=await runBinary(nginx,['-t']);
    return {...tested,status:tested.ok?'配置检查通过':'配置检查失败',
      identity:requireRoot?'root':process.getuid?.()===0?'root':'普通账户'};
  }
  async function sites(){
    guard();
    const warnings=[],records=new Map();
    let baseReal;
    try{baseReal=await fs.realpath(base);}
    catch(error){
      if(error.code==='ENOENT')
        return {source:'nginx-directories-missing',count:0,enabledCount:0,sites:[],warnings:['Nginx 配置目录不存在']};
      throw error;
    }
    const entries=async dir=>{
      try{
        const names=(await fs.readdir(join(base,dir))).sort();
        if(names.length>MAX_FILES)warnings.push(dir+' 超过 '+MAX_FILES+' 个文件，仅显示前部分');
        return names.slice(0,MAX_FILES);
      }catch(error){
        if(error.code!=='ENOENT')warnings.push(dir+' 无法读取：'+(error.code||'ERROR'));
        return [];
      }
    };
    const sample=async(dir,name)=>{
      const file=join(base,dir,name);
      try{
        const real=await fs.realpath(file);
        if(!within(real,baseReal)){warnings.push(dir+'/'+name+' 指向目录外，已跳过');return null;}
        const st=await fs.stat(file);
        if(!st.isFile()||st.size>MAX_BYTES){warnings.push(dir+'/'+name+' 超过大小限制或不是文件');return null;}
        const content=strictBytes(await fs.readFile(file));
        return {real,row:{name,location:dir,enabled:dir==='sites-available'?'未启用':dir==='conf.d'?'配置候选':'启用目录',
          ...parseNginxDirectives(content),file,revision:'',editable:dir==='sites-available'&&NAME.test(name)&&name!=='.'&&name!=='..'}};
      }catch(error){
        warnings.push(dir+'/'+name+' 读取失败：'+(error.code||'ERROR'));
        return null;
      }
    };
    for(const name of await entries('sites-available')){
      const data=await sample('sites-available',name);if(data)records.set(data.real,data.row);
    }
    for(const name of await entries('sites-enabled')){
      const data=await sample('sites-enabled',name);if(!data)continue;
      const known=records.get(data.real);
      if(known && known.name===name)known.enabled='启用链接';
      else records.set(data.real,data.row);
    }
    for(const name of await entries('conf.d')){
      if(!name.endsWith('.conf'))continue;
      const data=await sample('conf.d',name);
      if(data)records.set(data.real,data.row);
    }
    // Compute list revisions from the same complete config/link state used by apply().
    // A suspicious regular-file alias or mismatched enabled symlink is not editable.
    for(const row of records.values()){
      if(!row.editable)continue;
      try{
        const direct=await fs.lstat(row.file);
        if(!direct.isFile()||direct.isSymbolicLink())throw fail('站点配置不是常规文件',409);
        const state=await existing(row.name);
        row.revision=state.revision;
        row.enabled=state.link===null?'未启用':'启用链接';
      }catch(error){
        row.editable=false;
        warnings.push('无法安全编辑 '+row.name+'：'+(error.code||'需检查站点链接'));
      }
    }
    const result=[...records.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.file.localeCompare(b.file));
    return {source:'nginx-directories',count:result.length,
      enabledCount:result.filter(x=>x.enabled!=='未启用').length,sites:result,warnings:warnings.slice(0,60)};
  }
  async function read({name}){
    await checkDirectories();
    const state=await existing(name);
    if(!state)throw fail('站点文件不存在',404);
    return {name,content:state.content,revision:state.revision,enabled:state.link!==null};
  }
  // Prevent concurrent web requests from interleaving snapshot, validation and rollback.
  let queue=Promise.resolve();
  const serial=fn=>{const current=queue.then(fn);queue=current.catch(()=>{});return current;};
  async function apply({name,operation,revision,content}){
    return serial(async()=>{
      await checkDirectories();
      safeName(name);
      if(!['create','edit','enable','disable','remove'].includes(operation))
        throw fail('无效的网站操作');
      const before=await existing(name);
      if(operation==='create'){
        if(before)throw fail('同名站点已经存在',409);
        if(revision!=='')throw fail('新建网站的版本标识必须为空',409);
        // Never overwrite a foreign enabled entry, even when available is absent.
        if(await oldLink(name)!==null)throw fail('同名启用链接已存在',409);
      }else{
        if(!before)throw fail('站点不存在',404);
        if(before.revision!==revision)throw fail('站点已经变化，请刷新后重试',409);
      }
      if(['create','edit'].includes(operation)){
        if(typeof content!=='string'||content.length<1||Buffer.byteLength(content)>MAX_BYTES ||
            content.includes('\0')||!content.trim())
          throw fail('网站配置必须是非空 UTF-8 文本且不超过 64 KiB',413);
      }else if(content!==undefined)throw fail('本操作不接受配置内容');
      const file=pathFor(name),linkPath=join(enabled,name),wasEnabled=before?.link!==null && before!==null;
      if(operation==='enable'&&wasEnabled)throw fail('网站已经启用',409);
      if(operation==='disable'&&!wasEnabled)throw fail('网站已经停用',409);
      let changed=false;
      const restore=async()=>{
        if(before)await atomicReplace(file,before.bytes,before.stat);
        else await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
        if(before?.link!==null && before){
          await fs.unlink(linkPath).catch(error=>{if(error.code!=='ENOENT')throw error;});
          await fs.symlink(before.link,linkPath);
        }else await fs.unlink(linkPath).catch(error=>{if(error.code!=='ENOENT')throw error;});
      };
      let afterEnabled=wasEnabled;
      try{
        if(operation==='create'||operation==='edit'){
          changed=true;
          await atomicReplace(file,Buffer.from(content,'utf8'),before?.stat);
        }else if(operation==='enable'){
          changed=true;await fs.symlink('../sites-available/'+name,linkPath);afterEnabled=true;
        }else if(operation==='disable'){
          changed=true;await fs.unlink(linkPath);afterEnabled=false;
        }else if(operation==='remove'){
          changed=true;
          if(wasEnabled)await fs.unlink(linkPath);
          await fs.unlink(file);afterEnabled=false;
        }
        const tested=await check();
        if(!tested.ok){
          await restore();
          return {ok:false,status:'配置检查失败，改动已恢复',revision:before?.revision??'',
            validated:false,reloaded:false,output:tested.output};
        }
        const activeChanged=wasEnabled||afterEnabled;
        if(activeChanged){
          const reload=await runBinary(systemctl,['reload','nginx.service']);
          if(!reload.ok){
            await restore();
            const recovery=await runBinary(systemctl,['reload','nginx.service']);
            if(!recovery.ok)throw fail('Nginx 重载失败；文件已恢复，但恢复后的重载也失败，须人工检查',503);
            return {ok:false,status:'重载失败，文件已恢复',revision:before?.revision??'',
              validated:false,reloaded:false,output:reload.output};
          }
        }
        const current=operation==='remove'?null:await existing(name);
        let status=activeChanged?'修改成功，配置检查与重载完成':'修改成功；未启用站点不参与完整配置检查';
        if(operation==='remove'){
          // This is deliberately AFTER successful nginx -t / reload. Certbot
          // deletion is irreversible, so NEVER put it inside the site rollback
          // transaction. Fail closed on unknown/shared references.
          let result;
          try{result=await cleanup.cleanup(before.content);}
          catch{result={deleted:[],retained:[],uncertain:true};}
          if(result.deleted.length)
            status+='；已自动删除 '+result.deleted.length+' 份不再使用的 Certbot 证书及续期配置';
          if(result.uncertain)
            status+='；无法确定是否存在其他引用或清理失败，相关证书已保留';
          else if(result.retained.length)
            status+='；共享证书已保留';
        }
        return {ok:true,status,
          revision:current?.revision??'',validated:activeChanged,reloaded:activeChanged,output:tested.output};
      }catch(error){
        if(changed){
          try{await restore();}
          catch{throw fail('操作失败且无法完全恢复文件，请检查 Nginx 配置',500);}
        }
        throw error;
      }
    });
  }
  async function status(){
    const version=await runBinary(nginx,['-v']);
    const system=await runBinary(systemctl,['show','nginx.service',
      '--property=ActiveState','--property=SubState','--property=UnitFileState','--no-pager']);
    const state=Object.fromEntries([...system.output.matchAll(/^(ActiveState|SubState|UnitFileState)=(.*)$/gm)]
      .map(([,key,value])=>[key,value]));
    const tested=await check();
    return {installed:version.ok,version:(version.output.match(/nginx\/[0-9.]+/)??[''])[0],
      active:state.ActiveState==='active',enabled:state.UnitFileState==='enabled',
      state:state.ActiveState||'unknown',subState:state.SubState||'unknown',configOk:tested.ok};
  }
  async function service({operation}){
    guard();
    const allowed=['start','stop','restart','reload','enable','disable'];
    if(!allowed.includes(operation))throw fail('不支持的 Nginx 服务操作');
    if(['start','restart','reload'].includes(operation)){
      const tested=await check();
      if(!tested.ok)return {ok:false,status:'配置检查失败，未执行服务操作',output:tested.output};
    }
    const done=await runBinary(systemctl,[operation,'nginx.service']);
    return {ok:done.ok,status:done.ok?'Nginx 服务操作成功':'Nginx 服务操作失败',output:done.output};
  }
  const certName=name=>safeName(name);
  async function certificates(){
    guard();
    const warnings=[],certificates=[];
    let installed=true;
    try{const st=await fs.stat(certbot);installed=st.isFile();}
    catch(e){if(e.code==='ENOENT')installed=false;else throw e;}
    let entries=[];
    try{entries=await fs.readdir(certificateRoot,{withFileTypes:true});}
    catch(e){if(e.code!=='ENOENT')warnings.push('无法读取 Certbot 证书目录：'+e.code);}
    if(entries.length>100)warnings.push('证书超过 100 项，仅展示前 100 项');
    const today=Date.now(),archiveRoot=resolve(dirname(certificateRoot),'archive');
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name)).slice(0,100)){
      const name=entry.name;
      if(!entry.isDirectory()||!NAME.test(name)||name==='.'||name==='..')continue;
      const file=join(certificateRoot,name,'cert.pem');
      try{
        const actual=await fs.realpath(file);
        // Follow Certbot's standard live -> archive certificate symlink only.
        if(!within(actual,archiveRoot))throw Error('证书不在受管 archive 目录');
        const stat=await fs.stat(actual);
        if(!stat.isFile()||stat.size>1024*1024)throw Error('证书文件类型或大小异常');
        const certificate=new X509Certificate(await fs.readFile(actual));
        const end=Date.parse(certificate.validTo),start=Date.parse(certificate.validFrom);
        if(!Number.isFinite(end)||!Number.isFinite(start))throw Error('证书日期不可解析');
        const daysRemaining=Math.ceil((end-today)/86400000);
        const domains=[...new Set([...(certificate.subjectAltName??'').matchAll(/DNS:([^,]+)/g)]
          .map(m=>m[1].trim()).filter(Boolean))].slice(0,32);
        certificates.push({name,domains,issuer:certificate.issuer.slice(0,500),
          validFrom:new Date(start).toISOString(),validTo:new Date(end).toISOString(),
          daysRemaining,status:daysRemaining<=0?'expired':daysRemaining<=30?'expiring':'valid',
          certificatePath:file});
      }catch(e){warnings.push('证书 '+name+' 读取失败：'+String(e.message).slice(0,160));}
    }
    return {provider:'Certbot / Let’s Encrypt',installed,count:certificates.length,
      certificates,warnings:warnings.slice(0,32)};
  }
  async function renew({name}){
    guard();certName(name);
    const current=await certificates();
    if(!current.installed)throw fail('尚未安装 Certbot',404);
    if(!current.certificates.some(cert=>cert.name===name))
      throw fail('未找到可安全管理的 Certbot 证书',404);
    // No force-renewal and no arbitrary domains, paths, plugins or hooks from Web.
    // Certbot only renews due certificates under its existing renewal profile.
    const outcome=await runBinary(certbot,['renew','--non-interactive','--cert-name',name],150000);
    if(!outcome.ok)return {ok:false,status:'证书续期失败，Nginx 未重载',output:outcome.output,reloaded:false};
    const running=await runBinary(systemctl,['is-active','--quiet','nginx.service']);
    if(!running.ok)return {ok:true,status:'Certbot 续期检查成功；Nginx 未运行，未自动启动',
      output:outcome.output,reloaded:false};
    const validated=await check();
    if(!validated.ok)return {ok:false,status:'Certbot 已执行但 Nginx 配置检查失败，未重载',
      output:validated.output,reloaded:false};
    const reload=await runBinary(systemctl,['reload','nginx.service']);
    return {ok:reload.ok,status:reload.ok?'Certbot 续期检查完成，Nginx 已重载':
      'Certbot 已执行但 Nginx 重载失败',
      output:(outcome.output+'\n'+reload.output).trim().slice(0,4000),reloaded:reload.ok};
  }
  return {status,service,certificates,renew,sites,read,check,apply,listenAddresses};
}
