import * as fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';

const exec=promisify(execFile);
const error=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const sha=b=>createHash('sha256').update(b).digest('hex');
const MAX_BYTES=1048576;
const PINNED_RELEASE='v5.47.0';
const PINNED_SHA256='56215328ad7a65e387e772af22232ac6531c34a1bb2252a64599a3a41aa7de5c';
const ASSET_URL='https://github.com/v2fly/v2ray-core/releases/download/'+PINNED_RELEASE+'/v2ray-linux-64.zip';
const fixedArgs={timeout:15000,maxBuffer:32768,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C'}};
const allowedFeatures=['inbounds','outbounds','routing','dns','transport','log','policy','api','stats','reverse','observatory','burstObservatory','metrics','inboundDetour','outboundDetour'];
async function exists(path){
  try{return await fs.lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function execSafe(bin,args,opts={}){
  try{
    const {stdout='',stderr=''}=await exec(bin,args,{...fixedArgs,...opts});
    return {ok:true,output:(stderr+'\n'+stdout).trim().slice(0,4000)};
  }catch(e){
    return {ok:false,output:String(e.stderr||e.stdout||e.message).slice(0,4000)};
  }
}
function parseConfig(content){
  if(typeof content!=='string'||!content.trim()||Buffer.byteLength(content)>MAX_BYTES||content.includes('\0'))
    throw error('配置为空、过大或含无效字符',413);
  let parsed;
  try{parsed=JSON.parse(content);}catch{throw error('配置不是有效的 JSON');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw error('V2Ray 配置根节点必须是 JSON 对象');
  return parsed;
}
/** Fixed filesystem and executable allowlist. Alternate roots are for disposable tests only. */
export function createV2RayOperations({
  requireRoot=true,root='/usr/local',systemctl='/bin/systemctl',runner=execSafe,
  download=null,assetUrl=ASSET_URL,assetSha=PINNED_SHA256
}={}){
  if(requireRoot&&(root!=='/usr/local'||systemctl!=='/bin/systemctl'||assetUrl!==ASSET_URL||assetSha!==PINNED_SHA256))
    throw Error('Privileged V2Ray paths/installer are fixed');
  const localBin=join(root,'bin/v2ray'),localConfig=join(root,'etc/v2ray/config.json');
  const localAsset=join(root,'share/v2ray'),serviceFile='/etc/systemd/system/v2ray.service';
  const alternativeBin=requireRoot?'/usr/bin/v2ray':join(root,'bin/v2ray-apt');
  const alternativeConfig=requireRoot?'/etc/v2ray/config.json':join(root,'etc/v2ray/config-apt.json');
  const guard=()=>{if(requireRoot && process.getuid?.()!==0)throw error('需要已启用的 V2Ray root Action 执行器',503);};
  const which=async()=>{
    const primary=await exists(localBin);
    if(primary && primary.isFile())return {binary:localBin,configPath:localConfig};
    const fallback=await exists(alternativeBin);
    if(fallback && fallback.isFile())return {binary:alternativeBin,configPath:alternativeConfig};
    return {binary:'',configPath:localConfig};
  };
  async function configState(path){
    const st=await exists(path);
    if(!st)return null;
    if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES||
      requireRoot&&(st.uid!==0 || !!(st.mode&0o022)))throw error('配置文件权限、类型或大小不允许编辑',409);
    const bytes=await fs.readFile(path);
    if(bytes.length>MAX_BYTES)throw error('配置文件超过 1 MiB',413);
    let content;
    try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw error('配置不是有效 UTF-8',415);}
    return {bytes,content,revision:sha(bytes),st};
  }
  async function config(){
    guard();
    const chosen=await which();
    if(!chosen.binary)throw error('尚未安装 V2Ray',404);
    const state=await configState(chosen.configPath);
    if(!state)throw error('V2Ray 配置不存在',404);
    return {...chosen,...state};
  }
  async function status(){
    guard();
    const chosen=await which(),installed=!!chosen.binary;
    const configExists=!!await exists(chosen.configPath);
    const active=await runner(systemctl,['is-active','--quiet','v2ray.service']);
    const enabled=await runner(systemctl,['is-enabled','--quiet','v2ray.service']);
    let version='',inbounds=0,outbounds=0,features=[];
    if(installed){
      const v=await runner(chosen.binary,['version']);
      version=(v.output.match(/V2Ray\s+\d+\.\d+\.\d+/i)||[])[0]||v.output.split('\n')[0].slice(0,120);
      try{
        const state=await configState(chosen.configPath);
        if(state){
          const json=parseConfig(state.content);
          inbounds=(json.inbounds?.length||0)+(json.inboundDetour?.length||0);
          outbounds=(json.outbounds?.length||0)+(json.outboundDetour?.length||0);
          features=allowedFeatures.filter(key=>Object.hasOwn(json,key));
        }
      }catch{/* Status must stay available for manual repair of malformed config. */}
    }
    return {installed,version,service:active.ok?'running':'stopped',enabled:enabled.ok,
      binary:chosen.binary,configPath:chosen.configPath,configExists,inbounds,outbounds,features,
      message:installed?(configExists?'V2Ray 已安装，可编辑和校验现有配置':'内核已安装，但没有找到主配置'):'未检测到 V2Ray 内核'};
  }
  async function read(){
    const data=await config();
    return {content:data.content,revision:data.revision,configPath:data.configPath};
  }
  async function temporary(path,content,fn){
    const parent=dirname(path),name=join(parent,'.lp-v2ray-'+randomUUID()+'.json');
    const dir=await exists(parent);
    if(!dir?.isDirectory()||dir.isSymbolicLink()||requireRoot&&(dir.uid!==0||!!(dir.mode&0o022)))
      throw error('V2Ray 配置目录不安全或不存在',503);
    try{
      await fs.writeFile(name,content,{flag:'wx',mode:0o600});
      return await fn(name);
    }finally{await fs.unlink(name).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  async function checkCandidate({content}){
    guard();parseConfig(content);
    const chosen=await which();
    if(!chosen.binary)throw error('请先安装 V2Ray 内核',404);
    const trial=await temporary(chosen.configPath,content,filename=>
      runner(chosen.binary,['test','-c',filename],{timeout:25000}));
    return {ok:trial.ok,message:trial.ok?'V2Ray 配置检查通过':'V2Ray 配置检查失败',output:trial.output};
  }
  async function atomicWrite(path,bytes,stat){
    const tmp=join(dirname(path),'.lp-v2ray-'+randomUUID()+'.json');
    try{
      await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});
      await fs.chown(tmp,stat.uid,stat.gid);
      await fs.chmod(tmp,stat.mode&0o7777);
      await fs.rename(tmp,path);
    }finally{await fs.unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  let gate=Promise.resolve();
  const serial=fn=>{const next=gate.then(fn);gate=next.catch(()=>{});return next;};
  const save=({content,revision})=>serial(async()=>{
    guard();parseConfig(content);
    const data=await config();
    if(revision!==data.revision)throw error('配置已在外部修改，请刷新后重试',409);
    const checked=await checkCandidate({content});
    if(!checked.ok)return {ok:false,message:'未保存：配置检查失败',output:checked.output,revision,restarted:false};
    const bytes=Buffer.from(content,'utf8');
    if(bytes.equals(data.bytes))return {ok:true,message:'配置没有变化',output:checked.output,revision,restarted:false};
    const beforeRunning=(await runner(systemctl,['is-active','--quiet','v2ray.service'])).ok;
    await atomicWrite(data.configPath,bytes,data.st);
    if(beforeRunning){
      const restarted=await runner(systemctl,['restart','v2ray.service'],{timeout:20000});
      if(!restarted.ok){
        await atomicWrite(data.configPath,data.bytes,data.st);
        const restored=await runner(systemctl,['restart','v2ray.service'],{timeout:20000});
        if(!restored.ok)throw error('重启失败，配置已恢复，但服务恢复也失败，请检查 v2ray.service',503);
        return {ok:false,message:'重启失败；已恢复原配置',output:restarted.output,revision,restarted:false};
      }
    }
    return {ok:true,message:beforeRunning?'配置保存成功，V2Ray 已重启':'配置保存成功；服务原本未运行，未自动启动',
      output:checked.output,revision:sha(bytes),restarted:beforeRunning};
  });
  async function service({operation}){
    guard();
    const chosen=await which();
    if(!chosen.binary)throw error('请先安装 V2Ray',404);
    const command=operation==='enable'||operation==='disable'
      ?[operation,'v2ray.service']:[operation,'v2ray.service'];
    const result=await runner(systemctl,command,{timeout:20000});
    return {ok:result.ok,message:result.ok?'服务操作已完成':'服务操作失败',output:result.output};
  }
  async function fetchAsset(url,dest){
    // Only the fixed, official V2Fly release and its GitHub release-asset redirects.
    const {pipeline}=await import('node:stream/promises');
    const {Readable}=await import('node:stream');
    const {createWriteStream}=await import('node:fs');
    let u=url,response;
    for(let redirects=0;redirects<=5;redirects++){
      const parsed=new URL(u);
      if(parsed.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com'].includes(parsed.hostname))
        throw error('V2Ray 官方安装包跳转到未允许的地址',503);
      response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(90000)});
      if(response.status>=300&&response.status<400&&response.headers.get('location')){
        u=new URL(response.headers.get('location'),u).href;continue;
      }
      if(!response.ok || !response.body)throw error('下载官方 V2Ray 安装包失败：HTTP '+response.status,503);
      const length=Number(response.headers.get('content-length')||0);
      if(length>30000000)throw error('官方压缩包超过大小限制',413);
      await pipeline(Readable.fromWeb(response.body),createWriteStream(dest,{flags:'wx',mode:0o600}));
      const st=await fs.stat(dest);
      if(st.size>30000000)throw error('官方压缩包超过大小限制',413);
      return;
    }
    throw error('V2Ray 官方安装包重定向过多',503);
  }
  const install=({confirm})=>serial(async()=>{
    guard();
    if(confirm!==true)throw error('需要确认安装',400);
    if(process.platform!=='linux'||process.arch!=='x64')throw error('安装按钮目前仅支持 Linux x86_64',501);
    const existing=await which();
    if(existing.binary || await exists(localConfig) || await exists(serviceFile))
      throw error('发现 V2Ray 程序、配置或同名服务，拒绝覆盖；请手动确认现有安装',409);
    if(requireRoot && !await exists('/usr/bin/unzip'))throw error('缺少 unzip，无法解压官方包',503);
    const folder=await fs.mkdtemp(join(tmpdir(),'lp-v2ray-install-')),zip=join(folder,'release.zip'),out=join(folder,'unpacked');
    const added=[];
    try{
      await (download||fetchAsset)(assetUrl,zip);
      if(sha(await fs.readFile(zip))!==assetSha)throw error('官方压缩包 SHA-256 校验失败，已拒绝安装',503);
      await fs.mkdir(out,{mode:0o700});
      const extraction=await runner('/usr/bin/unzip',['-j','-o',zip,'v2ray','geoip.dat','geosite.dat','-d',out],{timeout:30000,maxBuffer:8192});
      if(!extraction.ok)throw error('官方压缩包解压失败',503);
      for(const name of ['v2ray','geoip.dat','geosite.dat']){
        const st=await fs.lstat(join(out,name));
        if(!st.isFile()||st.isSymbolicLink())throw error('安装包内容不是普通文件',503);
      }
      await fs.mkdir(dirname(localBin),{recursive:true});
      await fs.mkdir(dirname(localConfig),{recursive:true});
      await fs.mkdir(localAsset,{recursive:true});
      const publish=async(src,dest,mode)=>{
        if(await exists(dest))throw error('目标文件已存在，拒绝覆盖：'+dest,409);
        await fs.copyFile(src,dest,fs.constants.COPYFILE_EXCL);
        added.push(dest);await fs.chmod(dest,mode);
      };
      await publish(join(out,'v2ray'),localBin,0o755);
      await publish(join(out,'geoip.dat'),join(localAsset,'geoip.dat'),0o644);
      await publish(join(out,'geosite.dat'),join(localAsset,'geosite.dat'),0o644);
      const initial=JSON.stringify({
        log:{loglevel:'warning'},
        inbounds:[{tag:'socks-local',listen:'127.0.0.1',port:10808,protocol:'socks',
          settings:{auth:'noauth',udp:false}}],
        outbounds:[{tag:'direct',protocol:'freedom',settings:{}}]
      },null,2)+'\n';
      await fs.writeFile(localConfig,initial,{flag:'wx',mode:0o644});added.push(localConfig);
      const unit='[Unit]\nDescription=V2Ray Service\nAfter=network-online.target\nWants=network-online.target\n\n'+
        '[Service]\nType=simple\nUser=nobody\nEnvironment=V2RAY_LOCATION_ASSET=/usr/local/share/v2ray\n'+
        'ExecStart=/usr/local/bin/v2ray run -config /usr/local/etc/v2ray/config.json\n'+
        'Restart=on-failure\nRestartSec=3\nNoNewPrivileges=true\n\n'+
        '[Install]\nWantedBy=multi-user.target\n';
      await fs.writeFile(serviceFile,unit,{flag:'wx',mode:0o644});added.push(serviceFile);
      const tested=await runner(localBin,['test','-c',localConfig],{timeout:30000});
      if(!tested.ok)throw error('新安装 V2Ray 的默认配置检查失败：'+tested.output.slice(0,400),503);
      const reload=await runner(systemctl,['daemon-reload']);
      if(!reload.ok)throw error('systemd 无法加载 V2Ray 服务',503);
      const enabled=await runner(systemctl,['enable','--now','v2ray.service'],{timeout:25000});
      if(!enabled.ok)throw error('V2Ray 已安装但服务启动失败：'+enabled.output.slice(0,400),503);
      added.length=0;
      return {ok:true,message:'已安装 V2Ray '+PINNED_RELEASE+'，默认只监听 127.0.0.1:10808',output:'官方发布包 SHA-256 校验通过',};
    }catch(e){
      if(added.length){
        await runner(systemctl,['disable','--now','v2ray.service'],{timeout:10000});
        for(const path of added.reverse())await fs.unlink(path).catch(()=>{});
        await runner(systemctl,['daemon-reload']);
      }
      throw e;
    }finally{await fs.rm(folder,{recursive:true,force:true});}
  });
  return {status,read,test:checkCandidate,save,service,install};
}
