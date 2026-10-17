import * as fs from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';

const CERT_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const bounded=(base,path)=>path===base||path.startsWith(base+sep);
const errorText='证书引用无法安全确认，已保留 Certbot 证书';

// Scan Nginx directives rather than matching certificate folder to website name.
// Comments must never count as references.
function uncomment(text){
  let out='',quote='',escaped=false,comment=false;
  for(const ch of text){
    if(ch==='\n'){comment=false;out+='\n';continue;}
    if(comment)continue;
    if(escaped){out+=ch;escaped=false;continue;}
    if(ch==='\\'){out+=ch;escaped=true;continue;}
    if(quote){out+=ch;if(ch===quote)quote='';continue;}
    if(ch==="'"||ch==='"'){out+=ch;quote=ch;continue;}
    if(ch==='#'){comment=true;continue;}
    out+=ch;
  }
  return out;
}
export function sslReferences(source){
  const text=uncomment(source);
  const paths=[],directive=/\bssl_certificate(?!_)\s+("[^"]*"|'[^']*'|[^\s;]+)\s*;/g;
  for(const match of text.matchAll(directive))
    paths.push(match[1].replace(/^(['"])(.*)\1$/,'$2'));
  // A directive with variables, malformed syntax or unresolved commands isn't
  // sufficient evidence that a lineage is unused.
  const mentions=(text.match(/\bssl_certificate(?!_)\s+/g)||[]).length;
  return {paths,uncertain:paths.length!==mentions,
    include:/\binclude\s+("[^"]*"|'[^']*'|[^\s;]+)\s*;/i.test(text)};
}
const normalize=(p)=>resolve(p);

export function createNginxCertbotCleanup({
  nginxRoot='/etc/nginx',certificateRoot='/etc/letsencrypt/live',
  renewalRoot='/etc/letsencrypt/renewal',certbot='/usr/bin/certbot',
  nginx='/usr/sbin/nginx',runner,requireRoot=true
}={}){
  if(requireRoot&&(nginxRoot!=='/etc/nginx'||certificateRoot!=='/etc/letsencrypt/live'||
    renewalRoot!=='/etc/letsencrypt/renewal'||certbot!=='/usr/bin/certbot'||nginx!=='/usr/sbin/nginx'))
    throw Error('Cannot redirect privileged Certbot deletion paths');
  if(typeof runner!=='function')throw Error('A fixed execFile runner is required');
  const live=normalize(certificateRoot),archive=resolve(live,'../archive');
  const renew=normalize(renewalRoot),nginxBase=normalize(nginxRoot);
  const inspect=async(src)=>{
    const parsed=sslReferences(src);
    if(parsed.uncertain)return {names:new Set(),uncertain:true};
    const names=new Set();
    for(const path of parsed.paths){
      if(!path.startsWith('/')||path.includes('$')){
        return {names:new Set(),uncertain:true};
      }
      // Match either a standard live symlink or any alternate symlink resolving
      // to that lineage's Certbot archive directory.
      const standard=relative(live,normalize(path)).split(sep);
      if(standard.length===2&&CERT_NAME.test(standard[0])&&
        ['cert.pem','fullchain.pem'].includes(standard[1])){
        names.add(standard[0]);continue;
      }
      try{
        const real=await fs.realpath(path);
        if(bounded(archive,real)){
          const pieces=relative(archive,real).split(sep);
          if(pieces.length===2&&CERT_NAME.test(pieces[0]))names.add(pieces[0]);
        }
      }catch{
        // Unknown missing/variable references could become valid after a
        // certbot update; we cannot prove an unrelated cert is unused.
        return {names:new Set(),uncertain:true};
      }
    }
    return {names,uncertain:false,include:parsed.include};
  };
  async function previouslyUsed(content){
    const data=await inspect(content);
    if(data.uncertain)return null;
    const candidates=[];
    for(const name of data.names){
      const renewal=join(renew,name+'.conf');
      try{
        const st=await fs.lstat(renew);
        if(!st.isFile()||st.isSymbolicLink()||(requireRoot&&(st.uid!==0||(st.mode&0o022)!==0)))continue;
        const dir=await fs.lstat(join(live,name));
        if(!dir.isDirectory()||dir.isSymbolicLink())continue;
        const certificate=await fs.realpath(join(live,name,'cert.pem'));
        if(!bounded(join(archive,name),certificate))continue;
        candidates.push(name);
      }catch{ /* No actual, recognized Certbot lineage: retain. */ }
    }
    return candidates;
  }
  async function scanAllRemaining(){
    const all=new Set();
    // Include currently effective nginx config, including snippets nested via
    // include outside sites-available. No unbounded subprocess output.
    let stdout;
    try{
      const result=await runner(nginx,['-T'],{
        timeout:15000,maxBuffer:8*1024*1024,
        env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}
      });
      stdout=result.stdout;
    }catch{return null;}
    if(typeof stdout!=='string'||!stdout.trim()||Buffer.byteLength(stdout)>8*1024*1024)return null;
    const effective=await inspect(stdout);
    if(effective.uncertain)return null;
    for(const name of effective.names)all.add(name);
    // Scan also disabled and non-included managed sites. Conflicting or
    // unreadable files, and includes in disabled sites, fail closed.
    const available=join(nginxBase,'sites-available');
    let entries;
    try{entries=await fs.readdir(available,{withFileTypes:true});}
    catch{return null;}
    if(entries.length>200)return null;
    for(const entry of entries){
      if(entry.name.startsWith('.'))continue;
      if(!entry.isFile())return null;
      let st,source;
      try{
        const path=join(available,entry.name);
        st=await fs.lstat(path);
        if(!st.isFile()||st.isSymbolicLink()||st.size>65536||
          (requireRoot&&(st.uid!==0||(st.mode&0o022)!==0)))return null;
        source=await fs.readFile(path,'utf8');
      }catch{return null;}
      const data=await inspect(source);
      if(data.uncertain)return null;
      // Nginx -T already resolves include for enabled sites. For disabled
      // sites we can't know what an include may reference; retain certificate.
      if(data.include){
        try{await fs.lstat(join(nginxBase,'sites-enabled',entry.name));}
        catch(e){if(e.code==='ENOENT')return null;return null;}
      }
      for(const name of data.names)all.add(name);
    }
    return all;
  }
  async function cleanup(content){
    let candidates;
    try{candidates=await previouslyUsed(content);}catch{return {deleted:[],retained:[],uncertain:true};}
    if(candidates===null)return {deleted:[],retained:[],uncertain:true};
    if(!candidates.length)return {deleted:[],retained:[],uncertain:false};
    const deleted=[],retained=[];
    for(const name of candidates){
      const currentlyUsed=await scanAllRemaining();
      if(currentlyUsed===null){retained.push(name);continue;}
      if(currentlyUsed.has(name)){retained.push(name);continue;}
      // Recheck the lineage just before the irreversible Certbot operation.
      const stillManaged=await previouslyUsed(content);
      if(!stillManaged?.includes(name)){retained.push(name);continue;}
      try{
        await runner(certbot,['delete','--cert-name',name,'--non-interactive','--quiet'],{
          timeout:60000,maxBuffer:32768,
          env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}
        });
        deleted.push(name);
      }catch{retained.push(name);}
    }
    return {deleted,retained,uncertain:retained.length>0};
  }
  return {cleanup};
}
