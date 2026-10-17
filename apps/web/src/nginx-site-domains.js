// Conservative text-only rewrite for simple, literal Nginx server_name directives.
// Deliberately refuse ambiguous multi-vhost/regex/variable configurations;
// these remain editable through the full Nginx configuration editor.
export function validNginxDomain(value){
  if(typeof value!=='string')return false;
  const name=value.trim().toLowerCase();
  if(name.length<3||name.length>253||name.includes('..')||name.startsWith('.')||name.endsWith('.'))return false;
  const plain=name.startsWith('*.')?name.slice(2):name;
  const labels=plain.split('.');
  if(labels.length<2||labels.some(label=>label.length<1||label.length>63||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))return false;
  return true;
}
function maskCommentsAndQuotes(source){
  const mask=source.split('');
  let quote='',comment=false,escaped=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(comment){
      if(ch==='\n'){comment=false;continue;}
      mask[i]=' ';continue;
    }
    if(quote){
      if(ch!=='\n')mask[i]=' ';
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch===quote)quote='';
      continue;
    }
    if(ch==='#'){comment=true;mask[i]=' ';continue;}
    if(ch==='"'||ch==="'"){quote=ch;mask[i]=' ';}
  }
  return mask.join('');
}
function serverNameDirectives(content){
  const masked=maskCommentsAndQuotes(content);
  const blocks=[],found=[];
  let boundary=0;
  for(let i=0;i<masked.length;i++){
    const ch=masked[i];
    if(ch==='{'){
      const head=masked.slice(boundary,i).trim();
      blocks.push(head==='server'?'server':'other');
      boundary=i+1;
    }else if(ch==='}'){
      blocks.pop();boundary=i+1;
    }else if(ch===';'){
      if(blocks.at(-1)==='server'){
        const body=masked.slice(boundary,i);
        const match=/^\s*server_name\s+/u.exec(body);
        if(match){
          const start=boundary+match[0].length,raw=content.slice(start,i);
          if(/[#"'\\;$\{\}]/.test(raw))throw Error('此配置的 server_name 使用了复杂语法，请通过 Nginx 配置编辑器修改域名');
          const values=raw.trim().split(/\s+/u);
          if(!values.length||values.some(x=>!validNginxDomain(x)))
            throw Error('此配置包含特殊 server_name，请通过 Nginx 配置编辑器修改域名');
          found.push({start,end:i,values});
        }
      }
      boundary=i+1;
    }
  }
  if(!found.length)throw Error('未找到可安全编辑的 server_name，请通过 Nginx 配置编辑器修改域名');
  const canonical=found[0].values.map(x=>x.toLowerCase()).join(' ');
  if(found.some(item=>item.values.map(x=>x.toLowerCase()).join(' ')!==canonical))
    throw Error('不同 server 区块具有不同域名，请通过 Nginx 配置编辑器分别调整');
  return found;
}
export function updateNginxSiteDomain(content,operation,domain){
  if(typeof content!=='string')throw Error('Nginx 配置内容不正确');
  if(!['add','remove'].includes(operation))throw Error('不支持的域名操作');
  if(!validNginxDomain(domain))throw Error('请输入合法域名，例如 example.com 或 *.example.com');
  const target=domain.trim().toLowerCase(),directives=serverNameDirectives(content);
  const existing=directives[0].values,found=existing.some(x=>x.toLowerCase()===target);
  if(operation==='add'&&found)throw Error('此域名已经存在');
  if(operation==='remove'&&!found)throw Error('此域名不在当前配置中');
  if(operation==='remove'&&existing.length===1)
    throw Error('不能删除最后一个域名，请使用 Nginx 配置编辑器处理特殊站点');
  const next=operation==='add'?[...existing, target]:existing.filter(x=>x.toLowerCase()!==target);
  let result=content;
  for(const directive of [...directives].reverse()){
    result=result.slice(0,directive.start)+next.join(' ')+result.slice(directive.end);
  }
  return result;
}
