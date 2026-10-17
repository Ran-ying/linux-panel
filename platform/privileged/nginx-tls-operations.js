import {lstat,readFile,realpath,readlink,stat} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {X509Certificate,createPrivateKey} from 'node:crypto';
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

export function createNginxTlsOperations({root='/etc/nginx',requireRoot=true,roots=allowedRoots}={}){
  if(requireRoot&&(root!=='/etc/nginx'||roots!==allowedRoots))
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
