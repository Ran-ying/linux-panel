import {readdir,realpath,stat,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve,sep} from 'node:path';

const exec=promisify(execFile);
const MAX_FILES=200,MAX_BYTES=256*1024;
function within(path,base){return path===base || path.startsWith(base+sep);}
export function parseNginxDirectives(source){
  // Advisory display only: this is NOT a full Nginx configuration parser.
  // Remove comments with a line-aware pass; # inside quoted strings survives.
  const clean=source.split('\n').map(line=>{
    let q='',slash=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(slash){slash=false;continue;}
      if(c==='\\'){slash=true;continue;}
      if(q){if(c===q)q='';continue;}
      if(c==='"'||c==="'"){q=c;continue;}
      if(c==='#')return line.slice(0,i);
    }
    return line;
  }).join('\n');
  const collect=key=>{
    const matches=[...clean.matchAll(new RegExp('(?:^|[;{}\\n])\\s*'+key+'\\s+([^;{}]{1,1000});','g'))];
    return [...new Set(matches.flatMap(match=>match[1].trim().split(/\s+/).filter(Boolean)))].slice(0,16).join(', ').slice(0,350);
  };
  return {serverNames:collect('server_name'),listens:collect('listen')};
}

export async function collectNginxSites({root='/etc/nginx'}={}){
  // root is an internal fixture parameter, never an Action input.
  const base=resolve(root),warnings=[],sites=new Map();
  let canonicalBase;
  try{canonicalBase=await realpath(base);}
  catch(error){
    if(error.code==='ENOENT')return {source:'nginx-directories-missing',count:0,enabledCount:0,sites:[],warnings:['Nginx 配置目录不存在']};
    throw error;
  }
  const entries=async dir=>{
    try{
      const names=(await readdir(join(base,dir))).sort();
      if(names.length>MAX_FILES)warnings.push(dir+' 文件数量超过读取上限，显示前 '+MAX_FILES+' 项');
      return names.slice(0,MAX_FILES);
    }catch(error){
      if(error.code!=='ENOENT')warnings.push(dir+' 无法读取：'+error.code);
      return [];
    }
  };
  const get=async (dir,name)=>{
    const path=join(base,dir,name);
    try{
      const actual=await realpath(path);
      if(!within(actual,canonicalBase)){warnings.push(dir+'/'+name+' 指向配置目录以外，已跳过');return null;}
      const info=await stat(actual);
      if(!info.isFile()||info.size>MAX_BYTES){warnings.push(dir+'/'+name+' 不是受支持的常规小文件');return null;}
      const content=await readFile(actual,'utf8');
      const {serverNames,listens}=parseNginxDirectives(content);
      return {actual,record:{name,location:dir,enabled:'未启用',serverNames,listens,file:path}};
    }catch(error){
      warnings.push(dir+'/'+name+' 无法解析：'+(error.code||'ERROR'));
      return null;
    }
  };
  for(const name of await entries('sites-available')){
    const found=await get('sites-available',name);
    if(found)sites.set(found.actual,found.record);
  }
  for(const name of await entries('sites-enabled')){
    const found=await get('sites-enabled',name);
    if(!found)continue;
    const existing=sites.get(found.actual);
    if(existing)existing.enabled='启用链接';
    else sites.set(found.actual,{...found.record,enabled:'启用目录'});
  }
  for(const name of await entries('conf.d')){
    if(!name.endsWith('.conf'))continue;
    const found=await get('conf.d',name);
    if(found)sites.set(found.actual,{...found.record,enabled:'配置候选'});
  }
  const result=[...sites.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.file.localeCompare(b.file));
  return {source:'nginx-directories',count:result.length,
    enabledCount:result.filter(x=>x.enabled!=='未启用').length,sites:result,warnings:warnings.slice(0,60)};
}

export async function checkNginx({command='/usr/sbin/nginx',runner=exec,identity=process.getuid?.()===0?'root':'普通账户'}={}){
  // Fixed argv and binary. Never use a shell, custom flags, or an input path.
  try{
    const {stdout='',stderr=''}=await runner(command,['-t'],{
      timeout:10000,maxBuffer:64*1024,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}
    });
    return {ok:true,status:'配置检查通过',exitCode:0,output:(stderr+'\n'+stdout).trim().slice(0,4000),identity};
  }catch(error){
    const absent=error.code==='ENOENT';
    const timedOut=error.killed===true || error.code==='ETIMEDOUT';
    return {ok:false,status:absent?'Nginx 未安装':timedOut?'配置检查超时':'配置检查失败',
      exitCode:Number.isInteger(error.code)?error.code:null,
      output:String((error.stderr||'')+'\n'+(error.stdout||'')||error.message).trim().slice(0,4000),identity};
  }
}
