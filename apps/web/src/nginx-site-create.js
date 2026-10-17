// Pure, conservative Nginx site generator for the new-site visual editor.
// Handwritten Nginx configuration remains the escape hatch for advanced setups.
const INVALID=/[\u0000-\u001f\u007f;{}'"\\$#]/;
const hostnameLabel=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function isIPv4(value){
  if(typeof value!=='string'||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))return false;
  return value.split('.').every(part=>+part<=255&&String(+part)===part);
}
export function validServerName(value){
  if(typeof value!=='string'||value.length>253||!value||INVALID.test(value))return false;
  if(isIPv4(value))return true;
  if(/^\d+\.\d+\.\d+\.\d+$/.test(value))return false;
  const name=value.startsWith('*.')?value.slice(2):value;
  const labels=name.split('.');
  return labels.length>=1&&labels.every(label=>hostnameLabel.test(label));
}
export function parseServerNames(text){
  if(typeof text!=='string'||text.length>1024)throw Error('域名列表过长');
  const names=[...new Set(text.trim().split(/[\s,]+/).filter(Boolean).map(x=>x.toLowerCase()))];
  if(!names.length||names.length>12||!names.every(validServerName))
    throw Error('请输入有效域名或 IPv4 地址，可用空格或逗号分隔，最多 12 个');
  return names;
}
export function defaultSiteFilename(hosts){
  const name=parseServerNames(hosts)[0];
  return name.startsWith('*.')?name.slice(2):name;
}
export function validateProxyTarget(target){
  if(typeof target!=='string')throw Error('请输入 HTTP 或 HTTPS 反代目标');
  const raw=target.trim();
  if(!raw||raw.length>500||/[\s\u0000-\u001f;{}'"\\$#]/.test(raw)||
    !/^https?:\/\//i.test(raw))throw Error('反代目标必须是安全的 http:// 或 https:// 地址');
  let url;
  try{url=new URL(raw);}catch{throw Error('反代目标地址或端口无效');}
  if(!url.hostname||url.username||url.password||url.hash||url.search||
    !['http:','https:'].includes(url.protocol))
    throw Error('反代目标不能含账号、密码、查询参数或片段');
  return raw;
}
export function buildNginxSiteConfig(input,{availableAddresses=['0.0.0.0','127.0.0.1']}={}){
  if(!input||typeof input!=='object')throw Error('缺少新建网站配置');
  const names=parseServerNames(input.hosts);
  const bind=input.bindAddress||'0.0.0.0';
  if(!isIPv4(bind)||!availableAddresses.includes(bind))
    throw Error('监听 IP 必须选择本机现有的 IPv4 地址或 0.0.0.0');
  const port=Number(input.port);
  if(!Number.isInteger(port)||port<1||port>65535||
    String(input.port??'')!==String(port))
    throw Error('监听端口必须为 1 到 65535 的整数');
  if(!['static','proxy'].includes(input.kind))throw Error('请选择静态网站或反向代理');
  const lines=[
    'server {',
    '    listen '+bind+':'+port+';',
    '    server_name '+names.join(' ')+';',
    ''
  ];
  if(input.kind==='static'){
    const path=String(input.root??'').trim();
    if(!path.startsWith('/')||path.length>512||INVALID.test(path)||
      /\s/.test(path)||path.split('/').includes('..'))
      throw Error('静态网站目录必须是有效的绝对路径，例如 /var/www/html');
    lines.push('    root '+path+';','    index index.html;');
  }else{
    const target=validateProxyTarget(input.proxyTarget);
    lines.push(
      '    location / {',
      '        proxy_pass '+target+';',
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '    }'
    );
  }
  lines.push('}','');
  return lines.join('\n');
}
