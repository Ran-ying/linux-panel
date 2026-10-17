import {readdir,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createNginxOperations} from './nginx-operations.js';
const exec=promisify(execFile);
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export function createCertbotOperations({renewalDir='/etc/letsencrypt/renewal',requireRoot=true,
  nginxOps=createNginxOperations(),runner=exec}={}){
  if(requireRoot&&renewalDir!=='/etc/letsencrypt/renewal')
    throw Error('Cannot redirect privileged Certbot path');
  const guard=()=>{if(requireRoot&&process.getuid?.()!==0)throw fail('需要受控 root 执行器',503);};
  const timer=async(arg)=>{
    try{const x=await runner('/bin/systemctl',[arg,'certbot.timer'],{timeout:4000,maxBuffer:4096});
      if(arg==='is-active')return x.stdout.trim()==='active';
      return x.stdout.trim()==='enabled';
    }catch{return false;}
  };
  async function list(){
    guard();
    const [inventory,active,enabled]=await Promise.all([nginxOps.certificates(),
      timer('is-active'),timer('is-enabled')]);
    const known=new Map(inventory.certificates.map(c=>[c.name,c])),certificates=[],warnings=[...inventory.warnings];
    let entries=[];
    try{entries=await readdir(renewalDir,{withFileTypes:true});}
    catch(e){if(e.code!=='ENOENT')warnings.push('无法读取续期配置目录');}
    for(const ent of entries.filter(e=>e.isFile()&&e.name.endsWith('.conf')).slice(0,150)){
      const name=ent.name.slice(0,-5);if(!NAME.test(name))continue;
      try{
        const text=await readFile(renewalDir+'/'+ent.name,'utf8');
        const authenticator=(/^\s*authenticator\s*=\s*([A-Za-z0-9_-]+)\s*$/m.exec(text)?.[1]||'未知').slice(0,64);
        const certificate=known.get(name);
        certificates.push({name,domains:certificate?.domains||[],authenticator,
          validTo:certificate?.validTo||'',daysRemaining:certificate?.daysRemaining??0,
          status:certificate?.status||'unknown'});
      }catch{warnings.push(name+' 的续期配置无法读取');}
    }
    return {installed:inventory.installed,timerActive:active,timerEnabled:enabled,
      count:certificates.length,certificates,warnings:warnings.slice(0,32).map(s=>s.slice(0,240))};
  }
  async function renew({name}){
    guard();
    if(!NAME.test(name))throw fail('无效证书名称');
    const state=await list();
    if(!state.certificates.some(x=>x.name===name))throw fail('未登记为自动续期证书',404);
    return nginxOps.renew({name});
  }
  return {list,renew};
}
