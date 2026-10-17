import {lstat,readFile,realpath,readlink,stat,open,rename,unlink,chown,chmod} from 'node:fs/promises';
import {resolve,join,sep,dirname} from 'node:path';
import {X509Certificate,createPrivateKey,createPublicKey,createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const error=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const SAFE_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const within=(p,base)=>p===base||p.startsWith(base+sep);
const allowedRoots=['/etc/letsencrypt/archive','/etc/ssl'];
// Match only literal, directly present directives. Do not pretend this parser
// evaluates arbitrary include/variables/maps or replaces nginx -T.
function extractPairs(content){
  const withoutComments=content.split('\n').map(line=>{
    let quoted='',escaped=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(quoted){if(ch===quoted)quoted='';continue;}
      if(ch==='"'||ch==="'"){quoted=ch;continue;}
      if(ch==='#')return line.slice(0,i);
    }
    return line;
  }).join('\n');
  const collect=key=>[...withoutComments.matchAll(new RegExp('(?:^|[;{}\\n])\\s*'+key+'\\s+([^;{}]{1,512});','g'))]
    .map(m=>m[1].trim().replace(/^(['"])(.*)\1$/,'$2'));
  const certs=collect('ssl_certificate'),keys=collect('ssl_certificate_key');
  return {pairs:certs.map((certificatePath,i)=>({certificatePath,privateKeyPath:keys[i]||''})),
    certCount:certs.length,keyCount:keys.length};
}

export function createNginxTlsOperations({root='/etc/nginx',requireRoot=true,roots=allowedRoots,
  run=promisify(execFile),nginxBinary='/usr/sbin/nginx',systemctlBinary='/bin/systemctl'}={}){
  if(requireRoot&&(root!=='/etc/nginx'||roots!==allowedRoots||
    nginxBinary!=='/usr/sbin/nginx'||systemctlBinary!=='/bin/systemctl'))
    throw Error('Cannot redirect privileged TLS paths');
  const base=resolve(root);
  async function siteContent(name){
    if(!SAFE_NAME.test(name)||name==='.'||name==='..')throw error('网站名称无效');
    if(requireRoot&&process.getuid?.()!==0)throw error('仅限受控 root 读取',503);
    const file=join(base,'sites-available',name),link=join(base,'sites-enabled',name);
    let st;
    try{st=await lstat(file);}catch{throw error('找不到站点配置',404);}
    if(!st.isFile()||st.isSymbolicLink()||st.size>65536 ||
      (requireRoot&&(st.uid!==0||(st.mode&0o022)!==0)))
      throw error('站点配置文件不可安全读取',403);
    const text=await readFile(file,'utf8');
    try{const ls=await lstat(link);
      if(!ls.isSymbolicLink() || resolve(join(base,'sites-enabled'),await readlink(link))!==file)
        throw error('启用站点链接不符合预期',409);
    }catch(e){if(e.code!=='ENOENT')throw e;}
    return text;
  }
  const fileRead=async(path,{privateKey=false}={})=>{
    if(!path.startsWith('/')||path.includes('\0')||path.includes('$')||path.length>512)
      throw error('TLS 引用不是受支持的静态绝对路径',422);
    const resolved=await realpath(path);
    if(!roots.some(dir=>within(resolved,dir)))
      throw error('TLS 文件不在已允许的证书目录中',403);
    const fileStat=await stat(resolved);
    if(!fileStat.isFile()||fileStat.size>(privateKey?65536:65536))
      throw error('TLS 文件无效或超过限制',422);
    const contents=await readFile(resolved,'utf8');
    if(privateKey)createPrivateKey(contents);
    else new X509Certificate(contents);
    return contents;
  };
  async function reference(name){
    const conf=await siteContent(name);
    const parsed=extractPairs(conf);
    if(parsed.pairs.length>12)throw error('证书引用数量超出上限',422);
    if(parsed.certCount!==parsed.keyCount)
      throw error('证书与私钥配置数量不一致，无法可靠配对',422);
    return parsed.pairs;
  }

  // Version tokens are opaque content hashes, not certificate/key payloads.
  // Include both files and immutable reference paths to reject stale edits.
  const revisionFor=(ref,cert,key)=>createHash('sha256')
    .update(ref.certificatePath).update('\0').update(ref.privateKeyPath).update('\0')
    .update(cert).update('\0').update(key).digest('hex');
  async function currentPair(name,index){
    if(!Number.isInteger(index)||index<0||index>11)throw error('证书序号无效');
    const refs=await reference(name),ref=refs[index];
    if(!ref||!ref.privateKeyPath)throw error('站点没有对应的证书/私钥引用',404);
    const certificatePem=await fileRead(ref.certificatePath);
    const privatePem=await fileRead(ref.privateKeyPath,{privateKey:true});
    return {ref,certificatePem,privatePem,revision:revisionFor(ref,certificatePem,privatePem)};
  }
  async function safeTarget(path){
    if(typeof path!=='string'||!path.startsWith('/')||path.includes('\0')||
      path.includes('
    const refs=await reference(name),pairs=[],warnings=[];
    for(const ref of refs){
      try{
        const certificatePem=await fileRead(ref.certificatePath);
        const publicPem=new X509Certificate(certificatePem).publicKey.export({format:'pem',type:'spki'});
        const privatePem=await fileRead(ref.privateKeyPath,{privateKey:true});
        pairs.push({certificatePath:ref.certificatePath,privateKeyPath:ref.privateKeyPath,
          publicPem,certificatePem,revision:revisionFor(ref,certificatePem,privatePem),
          privateKeyConfigured:!!ref.privateKeyPath,status:'已配置'});
      }catch(e){
        warnings.push('证书路径不能读取或解析：'+e.message.slice(0,150));
        pairs.push({...ref,publicPem:'',certificatePem:'',revision:'',privateKeyConfigured:!!ref.privateKeyPath,status:'无法读取或解析公有证书'});
      }
    }
    if(!refs.length)warnings.push('此 Nginx 站点文件没有直接声明 ssl_certificate；可能通过 include 或上层配置继承。');
    return {name,pairs,warnings};
  }
  async function siteTlsKey({name,index}){
    if(!Number.isInteger(index)||index<0||index>11)throw error('证书序号无效');
    const refs=await reference(name),item=refs[index];
    if(!item||!item.privateKeyPath)throw error('未找到已配置的私钥引用',404);
    const privatePem=await fileRead(item.privateKeyPath,{privateKey:true});
    return {name,index,privatePem};
  }
  return {siteTls,siteTlsKey,saveTls};
}
)||path.length>512)throw error('不支持的 TLS 文件路径',422);
    const target=await realpath(path);
    if(!roots.some(dir=>within(target,dir)))throw error('证书文件不在允许的目录',403);
    const state=await stat(target),parent=await lstat(dirname(target));
    if(!state.isFile()||state.size>65536||!parent.isDirectory()||parent.isSymbolicLink()||
      (requireRoot&&(state.uid!==0||(state.mode&0o022)!==0||
        parent.uid!==0||(parent.mode&0o022)!==0)))
      throw error('证书文件或目录权限不允许安全保存',403);
    return {target,state};
  }
  async function replacePem(target,content,existing){
    const tmp=join(dirname(target),'.linux-panel-tls-'+randomUUID());
    let handle;
    try{
      handle=await open(tmp,'wx',0o600);
      await handle.writeFile(content,'utf8');
      await handle.sync();
      await handle.close();handle=null;
      await chown(tmp,existing.uid,existing.gid);
      await chmod(tmp,existing.mode&0o777);
      await rename(tmp,target);
      const dir=await open(dirname(target),'r');
      try{await dir.sync();}finally{await dir.close();}
    }finally{
      if(handle)await handle.close().catch(()=>{});
      await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});
    }
  }
  // Serialise this executor's edits. On-disk content is rechecked even inside
  // the lock to reject Certbot/external edits since the browser loaded it.
  let queue=Promise.resolve();
  const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  async function saveTls(input){
    return serial(async()=>{
      const {name,index,revision,certificatePem,privatePem,updateCertificate,updatePrivateKey}=input;
      if(typeof name!=='string'||!SAFE_NAME.test(name)||
        !Number.isInteger(index)||index<0||index>11||
        !/^[a-f0-9]{64}$/.test(revision)||
        typeof certificatePem!=='string'||typeof privatePem!=='string'||
        Buffer.byteLength(certificatePem)>65536||Buffer.byteLength(privatePem)>65536||
        !certificatePem||!privatePem||
        typeof updateCertificate!=='boolean'||typeof updatePrivateKey!=='boolean'||
        !(updateCertificate||updatePrivateKey))throw error('TLS 保存参数不合法');
      const before=await currentPair(name,index);
      if(before.revision!==revision)throw error('证书或私钥已发生变化，请刷新后重试',409);
      if(!updateCertificate&&certificatePem!==before.certificatePem)
        throw error('本次没有授权修改公有证书',400);
      if(!updatePrivateKey&&privatePem!==before.privatePem)
        throw error('本次没有授权修改私钥',400);
      let proposed,previous;
      try{
        proposed=new X509Certificate(certificatePem);
        previous=new X509Certificate(before.certificatePem);
        if(proposed.subjectAltName!==previous.subjectAltName)
          throw Error('证书域名必须与原证书一致');
        const derived=createPublicKey(createPrivateKey(privatePem)).export({type:'spki',format:'der'});
        const actual=proposed.publicKey.export({type:'spki',format:'der'});
        if(!derived.equals(actual))throw Error('证书公钥与私钥不匹配');
      }catch(e){throw error('证书或私钥无效：'+(e.message.includes('域名')?'证书域名不匹配':'证书与私钥格式或密钥不匹配'),422);}
      const changes=[];
      if(updateCertificate&&certificatePem!==before.certificatePem)
        changes.push({path:before.ref.certificatePath,content:certificatePem,old:before.certificatePem});
      if(updatePrivateKey&&privatePem!==before.privatePem)
        changes.push({path:before.ref.privateKeyPath,content:privatePem,old:before.privatePem});
      if(!changes.length)return {name,index,ok:true,status:'内容没有变化',revision:before.revision,reloaded:false};
      for(const change of changes){
        const {target,state}=await safeTarget(change.path);
        change.target=target;change.state=state;
        // Certbot uses live symlinks; replace only the already-resolved archive
        // file rather than destroying the live symlink.
        if(await realpath(change.path)!==target)throw error('证书路径在保存时发生变化',409);
      }
      if(new Set(changes.map(c=>c.target)).size!==changes.length)
        throw error('证书与私钥指向了同一文件',422);
      const exec=async(binary,args)=>{
        try{await run(binary,args,{timeout:12000,maxBuffer:32768,
          env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}});return true;}
        catch{return false;}
      };
      const installed=[];
      const rollback=async()=>{
        for(const change of [...installed].reverse())
          await replacePem(change.target,change.old,change.state);
      };
      try{
        for(const change of changes){
          // Catch concurrent symlink switches before each filesystem mutation.
          if(await realpath(change.path)!==change.target)
            throw error('证书引用路径已被其他程序更新，请刷新',409);
          installed.push(change); // Include the currently attempted replacement in rollback.
          await replacePem(change.target,change.content,change.state);
        }
        if(!await exec(nginxBinary,['-t']))throw error('Nginx 配置检查未通过',422);
        const active=await exec(systemctlBinary,['is-active','--quiet','nginx.service']);
        if(active&&!await exec(systemctlBinary,['reload','nginx.service']))
          throw error('Nginx 重载失败',503);
        const after=await currentPair(name,index);
        return {name,index,ok:true,status:active?'证书保存成功，Nginx 已重新加载':'证书已保存，Nginx 当前未运行',
          revision:after.revision,reloaded:active};
      }catch(cause){
        try{
          await rollback();
          // Recover in-memory TLS context if Nginx reload was attempted.
          await exec(systemctlBinary,['reload','nginx.service']);
        }catch{throw error('TLS 保存失败，自动回滚也失败，须人工检查证书文件',503);}
        // Never include file content, runner stderr, or raw private key in errors.
        throw error(cause.statusCode===409?'保存期间证书引用变化，内容已回滚':
          '证书保存未通过校验或重载，已恢复原文件',cause.statusCode===409?409:422);
      }
    });
  }

  async function siteTls({name}){
    const refs=await reference(name),pairs=[],warnings=[];
    for(const ref of refs){
      try{
        const certificatePem=await fileRead(ref.certificatePath);
        const publicPem=new X509Certificate(certificatePem).publicKey.export({format:'pem',type:'spki'});
        pairs.push({certificatePath:ref.certificatePath,privateKeyPath:ref.privateKeyPath,
          publicPem,certificatePem,privateKeyConfigured:!!ref.privateKeyPath,status:'已配置'});
      }catch(e){
        warnings.push('证书路径不能读取或解析：'+e.message.slice(0,150));
        pairs.push({...ref,publicPem:'',certificatePem:'',privateKeyConfigured:!!ref.privateKeyPath,status:'无法读取或解析公有证书'});
      }
    }
    if(!refs.length)warnings.push('此 Nginx 站点文件没有直接声明 ssl_certificate；可能通过 include 或上层配置继承。');
    return {name,pairs,warnings};
  }
  async function siteTlsKey({name,index}){
    if(!Number.isInteger(index)||index<0||index>11)throw error('证书序号无效');
    const refs=await reference(name),item=refs[index];
    if(!item||!item.privateKeyPath)throw error('未找到已配置的私钥引用',404);
    const privatePem=await fileRead(item.privateKeyPath,{privateKey:true});
    return {name,index,privatePem};
  }
  return {siteTls,siteTlsKey};
}
