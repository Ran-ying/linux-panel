import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const TEXT_LIMIT=1024*1024,UPLOAD_LIMIT=8*1024*1024;
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function filePath(path){
  if(typeof path!=='string' || !isAbsolute(path) || path.includes('\0'))throw fail('请填写绝对路径');
  return resolve(path);
}
function ordinaryUser(){
  if(process.getuid?.()===0)throw fail('文件操作必须以面板普通服务账户运行',503);
}
const revision=buffer=>createHash('sha256').update(buffer).digest('hex');
async function target(path){ordinaryUser();return fs.realpath(filePath(path));}
async function accounts(){
  const parse=async path=>new Map((await fs.readFile(path,'utf8').catch(()=>''))
    .split('\n').filter(line=>line && !line.startsWith('#')).map(line=>{const fields=line.split(':');return [Number(fields[2]),fields[0]];}));
  return {users:await parse('/etc/passwd'),groups:await parse('/etc/group')};
}
// Logical regular-file bytes; never traverse links or special devices. One
// shared budget bounds a listing even on /proc, deep trees or large disks.
async function directorySize(path,budget){
  let size=0,complete=true;
  const pending=[path];
  while(pending.length){
    if(budget.remaining<=0 || Date.now()>budget.deadline){complete=false;break;}
    let entries;
    try{entries=await fs.readdir(pending.pop(),{withFileTypes:true});}
    catch{complete=false;continue;}
    for(const entry of entries){
      if(--budget.remaining<0 || Date.now()>budget.deadline){complete=false;break;}
      const child=join(entry.parentPath,entry.name);
      if(entry.isDirectory())pending.push(child);
      else if(entry.isFile()){
        try{const stats=await fs.lstat(child);if(stats.isFile())size+=stats.size;else complete=false;}
        catch{complete=false;}
      }
    }
  }
  return {size,sizeComplete:complete};
}
async function listFilesImpl({path='/',offset=0,limit=200}={}){
  path=await target(path);
  const names=await fs.readdir(path,{withFileTypes:true});
  names.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const {users,groups}=await accounts(),budget={remaining:10000,deadline:Date.now()+1500},entries=[];
  for(const entry of names.slice(offset,offset+limit)){
    try{
      const full=join(path,entry.name),stats=await fs.lstat(full);
      const resolved=stats.isSymbolicLink()?await fs.stat(full).catch(()=>stats):stats;
      const type=resolved.isDirectory()?'directory':resolved.isFile()?'file':'other';
      const bytes=stats.isDirectory()?await directorySize(full,budget):
        {size:stats.isSymbolicLink() && type==='directory'?null:resolved.size,sizeComplete:!(stats.isSymbolicLink() && type==='directory')};
      entries.push({name:entry.name,type,symlink:stats.isSymbolicLink(),...bytes,
        permissions:(stats.mode & 0o7777).toString(8).padStart(4,'0'),
        owner:(users.get(stats.uid) ?? String(stats.uid))+':'+(groups.get(stats.gid) ?? String(stats.gid)),
        modifiedAt:stats.mtime.toISOString()});
    }catch{entries.push({name:entry.name,type:'other',symlink:entry.isSymbolicLink(),size:null,sizeComplete:false,permissions:'—',owner:'—',modifiedAt:''});}
  }
  return {path,parent:path==='/'?null:dirname(path),entries,total:names.length,
    nextOffset:offset+entries.length<names.length?offset+entries.length:null};
}
async function readTextImpl({path}){
  path=await target(path);
  const handle=await fs.open(path,constants.O_RDONLY | constants.O_NONBLOCK);
  try{
    const stats=await handle.stat();
    if(!stats.isFile())throw fail('只能编辑普通文本文件',415);
    if(stats.size>TEXT_LIMIT)throw fail('文本文件超过 1 MiB',413);
    const buffer=Buffer.alloc(TEXT_LIMIT+1);
    let bytesRead=0;
    while(bytesRead<buffer.length){const next=await handle.read(buffer,bytesRead,buffer.length-bytesRead,bytesRead);if(!next.bytesRead)break;bytesRead+=next.bytesRead;}
    if(bytesRead>TEXT_LIMIT)throw fail('文本文件超过 1 MiB',413);
    const bytes=buffer.subarray(0,bytesRead);
    let content;
    try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
    catch{throw fail('此文件不是 UTF-8 文本',415);}
    if(content.includes('\0'))throw fail('二进制文件不能在文本编辑器打开',415);
    return {path,content,revision:revision(bytes),size:bytesRead,modifiedAt:stats.mtime.toISOString()};
  }finally{await handle.close();}
}
async function writeTextImpl({path,content,revision:expected}){
  const current=await readText({path});path=current.path;
  if(current.revision!==expected)throw fail('文件已被修改，请重新打开后再保存',409);
  const buffer=Buffer.from(content,'utf8');
  if(buffer.length>TEXT_LIMIT)throw fail('文本内容超过 1 MiB',413);
  await fs.access(path,constants.W_OK);
  const stats=await fs.stat(path),temp=join(dirname(path),'.panel-edit-'+randomUUID());
  try{
    await fs.writeFile(temp,buffer,{flag:'wx',mode:stats.mode & 0o777});
    // Keep an existing file's ownership; no elevation is used.
    await fs.chown(temp,stats.uid,stats.gid);
    await fs.chmod(temp,stats.mode & 0o777);
    if((await readText({path})).revision!==expected)throw fail('文件已被修改，请重新打开后再保存',409);
    await fs.rename(temp,path);
  }finally{await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  const next=await fs.stat(path);
  return {path,revision:revision(buffer),size:buffer.length,modifiedAt:next.mtime.toISOString()};
}
async function uploadFileImpl({path,contentBase64}){
  ordinaryUser();path=filePath(path);
  const buffer=Buffer.from(contentBase64,'base64');
  if(buffer.length>UPLOAD_LIMIT)throw fail('上传文件超过 8 MiB',413);
  if(buffer.toString('base64')!==contentBase64)throw fail('上传内容不是有效的 Base64');
  try{await fs.writeFile(path,buffer,{flag:'wx',mode:0o644});}
  catch(error){if(error.code==='EEXIST')throw fail('同名文件已存在，请更换名称',409);throw error;}
  return {path,size:buffer.length};
}

async function createEntryImpl({path,type}){
  ordinaryUser();path=filePath(path);
  if(type==='directory')await fs.mkdir(path,{mode:0o755});
  else if(type==='file')await fs.writeFile(path,'',{flag:'wx',mode:0o644});
  else throw fail('只能新建文件或目录');
  return {path};
}
function mutablePath(path){
  ordinaryUser();path=filePath(path);
  if(path==='/')throw fail('不能删除或重命名根目录',403);
  return path;
}
async function renameEntryImpl({path,newPath}){
  path=mutablePath(path);newPath=mutablePath(newPath);
  // Keep rename within the same directory, and refuse an existing destination.
  if(dirname(path)!==dirname(newPath))throw fail('重命名必须位于同一目录');
  try{await fs.lstat(newPath);throw fail('同名文件或目录已存在',409);}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.rename(path,newPath);
  return {path:newPath};
}
async function deleteEntryImpl({path}){
  path=mutablePath(path);
  const stats=await fs.lstat(path);
  if(stats.isDirectory())await fs.rm(path,{recursive:true,force:false});
  else await fs.unlink(path);
  return {path};
}

function expose(operation){
  return async input=>{
    try{return await operation(input);}
    catch(error){
      if(error.statusCode)throw error;
      const codes={ENOENT:[404,'文件或目录不存在'],ENOTDIR:[400,'路径不是目录'],EISDIR:[400,'路径指向目录'],
        EACCES:[403,'没有访问此文件或目录的权限'],EPERM:[403,'没有执行此文件操作的权限'],
        EROFS:[403,'文件系统只读'],ENOSPC:[507,'磁盘空间不足'],ELOOP:[400,'无法解析符号链接'],
        EEXIST:[409,'同名文件或目录已存在'],ENOTEMPTY:[409,'目标目录不是空目录']};
      const [status,message]=codes[error.code] ?? [500,'文件操作失败'];
      throw fail(message,status);
    }
  };
}
export const listFiles=expose(listFilesImpl),readText=expose(readTextImpl),
  writeText=expose(writeTextImpl),uploadFile=expose(uploadFileImpl),
  createEntry=expose(createEntryImpl),renameEntry=expose(renameEntryImpl),deleteEntry=expose(deleteEntryImpl);
