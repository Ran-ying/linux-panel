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
export async function listFiles({path='/',offset=0,limit=200}={}){
  path=await target(path);
  const names=await fs.readdir(path,{withFileTypes:true});
  names.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const entries=await Promise.all(names.slice(offset,offset+limit).map(async entry=>{
    try{
      const stats=await fs.stat(join(path,entry.name));
      return {name:entry.name,type:stats.isDirectory()?'directory':stats.isFile()?'file':'other',
        symlink:entry.isSymbolicLink(),size:stats.size,modifiedAt:stats.mtime.toISOString()};
    }catch{return {name:entry.name,type:'other',symlink:entry.isSymbolicLink(),size:0,modifiedAt:''};}
  }));
  return {path,parent:path==='/'?null:dirname(path),entries,total:names.length,
    nextOffset:offset+entries.length<names.length?offset+entries.length:null};
}
export async function readText({path}){
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
export async function writeText({path,content,revision:expected}){
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
export async function uploadFile({path,contentBase64}){
  ordinaryUser();path=filePath(path);
  const buffer=Buffer.from(contentBase64,'base64');
  if(buffer.length>UPLOAD_LIMIT)throw fail('上传文件超过 8 MiB',413);
  if(buffer.toString('base64')!==contentBase64)throw fail('上传内容不是有效的 Base64');
  try{await fs.writeFile(path,buffer,{flag:'wx',mode:0o644});}
  catch(error){if(error.code==='EEXIST')throw fail('同名文件已存在，请更换名称',409);throw error;}
  return {path,size:buffer.length};
}
