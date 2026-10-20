import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {Readable} from 'node:stream';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export const TRANSFER_CHUNK=1024*1024;
export const TRANSFER_MAX_BYTES=64*1024*1024*1024;
export const UPLOAD_TTL_MS=24*60*60*1000;
export const MAX_UPLOAD_SESSIONS=32;
export const MAX_INFLIGHT_CHUNKS=4;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function filePath(path){
  if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))throw fail('请填写绝对路径');
  return resolve(path);
}
export function mapFileError(error){
  if(error?.statusCode)throw error;
  const codes={ENOENT:[404,'文件或目录不存在'],ENOTDIR:[400,'路径不是目录'],EISDIR:[400,'路径指向目录'],
    EACCES:[403,'执行账户没有访问此文件或目录的权限，或目录被服务隔离'],EPERM:[403,'执行账户没有执行此文件操作的权限'],
    EROFS:[403,'当前目录所在文件系统只读，可能受面板服务隔离限制'],ENOSPC:[507,'磁盘空间不足'],ELOOP:[400,'无法解析符号链接'],
    EEXIST:[409,'同名文件或目录已存在'],ENOTEMPTY:[409,'目标目录不是空目录'],
    ENAMETOOLONG:[400,'路径或名称过长'],EINVAL:[400,'文件操作参数无效'],EBUSY:[409,'文件或挂载点正在使用'],EXDEV:[409,'不支持跨文件系统操作']};
  const [status,message]=codes[error?.code]??[500,'文件操作失败'];
  throw fail(message,status);
}
export function rootUploadDir(){
  return process.env.PANEL_ROOT_UPLOAD_DIR||'/var/lib/linux-panel-upload-staging';
}
function safeName(name){
  if(typeof name!=='string'||!name||name==='.'||name==='..'||name.length>255||
    Buffer.byteLength(name)>255||/[\u0000-\u001f\u007f]/.test(name))
    throw fail('文件名无效');
  return name;
}
// Walk the lexical path. A symlink component is refused so a write cannot
// leave the directory the caller named. `..` is collapsed by filePath first.
export async function literalDestination(input){
  const path=filePath(input);
  if(path==='/')throw fail('不能直接更改根目录',403);
  const parent=dirname(path),name=safeName(basename(path));
  let current='/';
  for(const part of parent.split('/').filter(Boolean)){
    safeName(part);
    current=join(current,part);
    let stats;
    try{stats=await fs.lstat(current);}
    catch(error){if(error.code==='ENOENT')throw fail('目录不存在',404);throw error;}
    if(stats.isSymbolicLink())throw fail('上传路径不能经过符号链接',400);
    if(!stats.isDirectory())throw fail('路径不是目录',400);
  }
  return {path:join(current,name),parent:current,name};
}
async function syncDirectory(folder){
  if(process.platform==='win32')return;
  const handle=await fs.open(folder,'r');
  try{await handle.sync();}finally{await handle.close();}
}
async function discard(stream){
  if(!stream)return;
  for await(const chunk of stream)void chunk;
}
// Copy into a new inode in the destination directory, then rename over a
// regular file or a symlink node. Rename does not follow a symlink, and an
// existing directory is left untouched.
export async function installRegularFile(target,size,read){
  if(!Number.isInteger(size)||size<0)throw fail('文件大小无效',400);
  const {path,parent,name}=await literalDestination(target);
  await fs.access(parent,constants.W_OK|constants.X_OK);
  const dest=join(parent,name);
  let existing=null;
  try{existing=await fs.lstat(dest);}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing?.isSymbolicLink())existing=null;
  else if(existing?.isDirectory())throw fail('同名文件夹已存在，不能用文件覆盖',409);
  else if(existing&&!existing.isFile())throw fail('不能覆盖该路径上的特殊文件',409);
  const temp=join(parent,`.panel-upload-${randomUUID()}`);
  const mode=existing?.isFile()?existing.mode&0o7777:0o644;
  const handle=await fs.open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,mode);
  try{
    let position=0;
    const buffer=Buffer.alloc(64*1024);
    while(position<size){
      const bytes=await read(buffer.subarray(0,Math.min(buffer.length,size-position)),position);
      if(!Number.isInteger(bytes)||bytes<1)throw fail('写入的文件长度不正确',500);
      await handle.write(buffer,0,bytes,position);
      position+=bytes;
    }
    if(position!==size)throw fail('写入的文件长度不正确',500);
    await handle.sync();
    if(existing?.isFile()){
      await handle.chown(existing.uid,existing.gid).catch(error=>{if(error.code!=='EPERM'&&error.code!=='EINVAL')throw error;});
      await handle.chmod(mode);
    }
  }catch(error){
    await handle.close();
    await fs.unlink(temp).catch(()=>{});
    throw error;
  }
  await handle.close();
  try{await fs.rename(temp,dest);}
  catch(error){await fs.unlink(temp).catch(()=>{});throw error;}
  await syncDirectory(parent);
  return {path:dest,size};
}
export async function ensureRealDirectory(target){
  const {path,parent,name}=await literalDestination(target);
  await fs.access(parent,constants.W_OK|constants.X_OK);
  const dest=join(parent,name);
  try{
    const stats=await fs.lstat(dest);
    if(stats.isSymbolicLink())throw fail('不能合并符号链接文件夹',400);
    if(stats.isDirectory())return {path:dest,created:false};
    throw fail('同名文件已存在，不能作为文件夹合并',409);
  }catch(error){
    if(error.statusCode||error.code!=='ENOENT')throw error;
  }
  await fs.mkdir(dest,{mode:0o755});
  return {path:dest,created:true};
}
export function parseByteRange(header,size){
  if(header==null||header==='')
    return {start:0,end:size>0?size-1:0,length:size,partial:false};
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!match||(match[1]===''&&match[2]===''))throw fail('无法识别的范围请求',416);
  if(size===0)throw fail('范围无效',416);
  let start,end;
  if(match[1]===''){
    const suffix=Number(match[2]);
    if(!Number.isSafeInteger(suffix)||suffix<=0)throw fail('范围无效',416);
    start=Math.max(0,size-suffix);end=size-1;
  }else{
    start=Number(match[1]);
    end=match[2]===''?size-1:Number(match[2]);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=size)
      throw fail('范围无效',416);
    end=Math.min(end,size-1);
  }
  return {start,end,length:end-start+1,partial:true};
}
export function contentDisposition(name){
  const cleaned=String(name||'download').replace(/[\r\n"]/g,'');
  const ascii=cleaned.replace(/[^\x20-\x7E]/g,'_')||'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned||'download')}`;
}
export const FILE_TRANSFER_SCHEMA={
  type:'object',additionalProperties:false,required:['op'],
  properties:{
    op:{type:'string',enum:['open','status','write','commit','abort','mkdir','stat','read']},
    path:{type:'string',minLength:1,maxLength:4096},
    size:{type:'integer',minimum:0,maximum:TRANSFER_MAX_BYTES},
    uploadId:{type:'string',pattern:UUID.source},
    offset:{type:'integer',minimum:0,maximum:TRANSFER_MAX_BYTES},
    length:{type:'integer',minimum:0,maximum:TRANSFER_CHUNK}
  }
};

export function createFileTransfer({
  privileged=false,uploadDir,maxBytes=TRANSFER_MAX_BYTES,ttlMs=UPLOAD_TTL_MS,chunkSize=TRANSFER_CHUNK,
  maxSessions=MAX_UPLOAD_SESSIONS,maxInflight=MAX_INFLIGHT_CHUNKS
}={}){
  if(!uploadDir)throw fail('未配置上传暂存目录',500);
  const boundedMax=Math.min(maxBytes,TRANSFER_MAX_BYTES);
  const boundedChunk=Math.min(chunkSize,TRANSFER_CHUNK);
  const inflightLimit=Math.max(1,Math.min(maxInflight,MAX_INFLIGHT_CHUNKS));
  const root=join(uploadDir,privileged?'root':'user');
  const sessions=join(root,'sessions');
  const tails=new Map();
  const lanes=new Map();
  let activeWrites=0;
  function guard(){
    if(privileged){if(process.getuid?.()!==0)throw fail('root 执行器必须以 root 运行',503);return;}
    if(process.getuid?.()===0)throw fail('文件操作必须以面板普通服务账户运行',503);
  }
  function sessionId(uploadId){
    if(typeof uploadId!=='string'||!UUID.test(uploadId))throw fail('上传会话无效');
    return uploadId;
  }
  function sessionPaths(uploadId){
    const id=sessionId(uploadId),dir=join(sessions,id);
    return {id,dir,meta:join(dir,'meta.json'),partial:join(dir,'partial'),chunks:join(dir,'chunks')};
  }
  function lane(uploadId){
    let state=lanes.get(uploadId);
    if(!state){
      state={inflight:0,committing:false,aborting:false,reservations:[],waiters:[]};
      lanes.set(uploadId,state);
    }
    return state;
  }
  function wake(state){
    const waiters=state.waiters.splice(0);
    for(const resolve of waiters)resolve();
  }
  function overlapsReservation(state,offset,length){
    const end=offset+length;
    return state.reservations.some(range=>offset<range.end&&end>range.offset);
  }
  function exclusive(uploadId,operation){
    const previous=tails.get(uploadId)??Promise.resolve();
    const run=previous.catch(()=>{}).then(operation);
    const settled=run.finally(()=>{if(tails.get(uploadId)===settled)tails.delete(uploadId);});
    settled.catch(()=>{});
    tails.set(uploadId,settled);
    return run;
  }
  async function removeSession(uploadId){
    const {dir}=sessionPaths(uploadId);
    await fs.rm(dir,{recursive:true,force:true});
  }
  async function readMeta(uploadId,{allowExpired=false}={}){
    const paths=sessionPaths(uploadId);
    let raw;
    try{raw=await fs.readFile(paths.meta,'utf8');}
    catch(error){if(error.code==='ENOENT')throw fail('上传会话不存在或已过期',404);throw error;}
    let meta;
    try{meta=JSON.parse(raw);}catch{await removeSession(uploadId);throw fail('上传会话无效',404);}
    if(meta?.version!==1||meta.uploadId!==paths.id||typeof meta.path!=='string'||
      !Number.isInteger(meta.size)||meta.size<0||meta.size>boundedMax||typeof meta.expiresAt!=='string'){
      await removeSession(uploadId);throw fail('上传会话无效',404);
    }
    if(Date.parse(meta.expiresAt)<=Date.now()){
      await removeSession(uploadId);
      if(!allowExpired)throw fail('上传会话不存在或已过期',404);
    }
    return {...meta,paths};
  }
  async function writeMeta(meta,paths){
    await fs.mkdir(paths.dir,{recursive:true,mode:0o700});
    const temp=paths.meta+'.tmp';
    const handle=await fs.open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC,0o600);
    try{await handle.writeFile(JSON.stringify(meta));await handle.sync();}
    finally{await handle.close();}
    await fs.rename(temp,paths.meta);
  }
  async function partialSize(paths){
    const stats=await fs.stat(paths.partial);
    if(!stats.isFile())throw fail('上传暂存文件无效',500);
    return stats.size;
  }
  async function listChunks(paths){
    let names=[];
    try{names=await fs.readdir(paths.chunks);}catch(error){if(error.code!=='ENOENT')throw error;return [];}
    const chunks=[];
    for(const name of names){
      if(!/^\d+$/.test(name))continue;
      const stats=await fs.stat(join(paths.chunks,name));
      if(!stats.isFile()||stats.size<1)continue;
      const offset=Number(name);
      if(!Number.isSafeInteger(offset))continue;
      chunks.push({offset,length:stats.size});
    }
    chunks.sort((left,right)=>left.offset-right.offset);
    return chunks;
  }
  function coverage(prefix,chunks){
    let cursor=prefix,receivedBytes=prefix;
    for(const chunk of chunks){
      const end=chunk.offset+chunk.length;
      if(end<=cursor)continue;
      receivedBytes+=chunk.offset>=cursor?chunk.length:end-cursor;
      if(chunk.offset<=cursor)cursor=end;
    }
    return {offset:cursor,receivedBytes};
  }
  async function describe(meta){
    return coverage(await partialSize(meta.paths),await listChunks(meta.paths));
  }
  function progress(meta,info){
    return {uploadId:meta.uploadId,path:meta.path,offset:info.offset,receivedBytes:info.receivedBytes,
      size:meta.size,chunkSize:boundedChunk,expiresAt:meta.expiresAt};
  }
  function alignedChunk(offset,length,size){
    return offset%boundedChunk===0&&(length===boundedChunk||offset+length===size);
  }
  function classify(offset,length,prefix,chunks,size){
    const end=offset+length;
    if(end<=prefix)return 'present';
    for(const chunk of chunks){
      const chunkEnd=chunk.offset+chunk.length;
      if(end<=chunk.offset||offset>=chunkEnd)continue;
      if(offset===chunk.offset&&length===chunk.length)return 'present';
      return 'conflict';
    }
    if(offset<prefix)return 'conflict';
    if(offset===prefix)return 'append';
    if(offset>prefix&&alignedChunk(offset,length,size))return 'side';
    return 'conflict';
  }
  async function writeFully(handle,chunk,position){
    let wrote=0;
    while(wrote<chunk.length){
      const {bytesWritten}=await handle.write(chunk,wrote,chunk.length-wrote,position+wrote);
      if(!bytesWritten)throw fail('分块写入中断',500);
      wrote+=bytesWritten;
    }
  }
  async function consume(stream,length,write){
    let got=0;
    for await(const piece of stream){
      const chunk=Buffer.isBuffer(piece)?piece:Buffer.from(piece);
      if(!chunk.length)continue;
      if(got+chunk.length>length)throw fail('分块超过声明长度',400);
      await write(chunk,got);
      got+=chunk.length;
    }
    if(got!==length)throw fail('分块长度不完整',400);
  }
  async function touch(meta){
    await exclusive(meta.uploadId,async()=>{
      const now=new Date();
      const expiresAt=new Date(now.getTime()+ttlMs).toISOString();
      await writeMeta({version:1,uploadId:meta.uploadId,path:meta.path,size:meta.size,
        createdAt:meta.createdAt,updatedAt:now.toISOString(),expiresAt},meta.paths);
      meta.updatedAt=now.toISOString();
      meta.expiresAt=expiresAt;
    });
  }
  function conflict(info,message='上传偏移与服务器已接收长度不一致'){
    return Object.assign(fail(message,409),{offset:info.offset,receivedBytes:info.receivedBytes});
  }
  async function sweep(){
    let names=[];
    try{names=await fs.readdir(sessions);}catch(error){if(error.code!=='ENOENT')throw error;return 0;}
    const now=Date.now();
    let live=0;
    for(const name of names){
      if(!UUID.test(name))continue;
      const metaPath=join(sessions,name,'meta.json');
      try{
        const meta=JSON.parse(await fs.readFile(metaPath,'utf8'));
        if(!meta?.expiresAt||Date.parse(meta.expiresAt)<=now)await fs.rm(join(sessions,name),{recursive:true,force:true});
        else live++;
      }catch{await fs.rm(join(sessions,name),{recursive:true,force:true});}
    }
    return live;
  }
  async function open({path,size,uploadId}={}){
    if(!Number.isInteger(size)||size<0||size>boundedMax)throw fail('文件大小超过限制',413);
    const destination=await literalDestination(path);
    await fs.access(destination.parent,constants.W_OK|constants.X_OK);
    if(uploadId){
      const meta=await readMeta(uploadId);
      if(meta.path!==destination.path||meta.size!==size)throw fail('上传会话与文件不匹配',409);
      return progress(meta,await describe(meta));
    }
    const live=await sweep();
    if(live>=maxSessions)throw fail('未完成的上传过多，请稍后再试',429);
    const id=randomUUID();
    const paths=sessionPaths(id);
    const now=new Date();
    const meta={version:1,uploadId:id,path:destination.path,size,createdAt:now.toISOString(),
      updatedAt:now.toISOString(),expiresAt:new Date(now.getTime()+ttlMs).toISOString()};
    await fs.mkdir(paths.dir,{recursive:true,mode:0o700});
    const created=await fs.open(paths.partial,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await created.close();
    await writeMeta(meta,paths);
    return progress(meta,{offset:0,receivedBytes:0});
  }
  async function status({uploadId}={}){
    const meta=await readMeta(uploadId);
    return progress(meta,await describe(meta));
  }
  async function write({uploadId,offset,length}={},stream){
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(length)||length<1||length>boundedChunk)
      throw fail('分块偏移或长度无效');
    const state=lane(sessionId(uploadId));
    for(;;){
      if(state.committing||state.aborting){await discard(stream);throw fail('上传已结束',409);}
      if(!overlapsReservation(state,offset,length))break;
      await new Promise(resolve=>state.waiters.push(resolve));
    }
    if(activeWrites>=inflightLimit){await discard(stream);throw fail('并发分块过多，请稍后再试',429);}
    activeWrites++;
    state.inflight++;
    const reservation={offset,end:offset+length};
    state.reservations.push(reservation);
    let meta;
    try{
      try{meta=await readMeta(uploadId);}
      catch(error){await discard(stream);throw error;}
      if(offset+length>meta.size){
        await discard(stream);
        throw fail('上传超出声明的文件大小',400);
      }
      const prefix=await partialSize(meta.paths);
      const chunks=await listChunks(meta.paths);
      const kind=classify(offset,length,prefix,chunks,meta.size);
      const info=coverage(prefix,chunks);
      if(kind==='present'){await discard(stream);return progress(meta,info);}
      if(kind!=='append'&&kind!=='side'){await discard(stream);throw conflict(info);}
      if(kind==='append'){
        const handle=await fs.open(meta.paths.partial,constants.O_RDWR|constants.O_NOFOLLOW);
        try{
          await consume(stream,length,(chunk,got)=>writeFully(handle,chunk,offset+got));
          await handle.sync();
        }catch(error){await handle.close();throw error;}
        await handle.close();
      }else{
        await fs.mkdir(meta.paths.chunks,{recursive:true,mode:0o700});
        const temp=join(meta.paths.chunks,offset+'-'+randomUUID()+'.part');
        const handle=await fs.open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
        try{
          await consume(stream,length,(chunk,got)=>writeFully(handle,chunk,got));
          await handle.sync();
        }catch(error){
          await handle.close();
          await fs.unlink(temp).catch(()=>{});
          throw error;
        }
        await handle.close();
        try{await fs.rename(temp,join(meta.paths.chunks,String(offset)));}
        catch(error){await fs.unlink(temp).catch(()=>{});throw error;}
      }
      await touch(meta);
      return progress(meta,await describe(meta));
    }finally{
      state.reservations=state.reservations.filter(range=>range!==reservation);
      state.inflight--;
      activeWrites--;
      wake(state);
    }
  }
  async function logicalReader(meta){
    const prefix=await partialSize(meta.paths);
    const chunks=await listChunks(meta.paths);
    const partial=await fs.open(meta.paths.partial,constants.O_RDONLY|constants.O_NOFOLLOW);
    const handles=new Map();
    return {prefix,chunks,
      async read(buffer,position){
        if(position<prefix){
          const {bytesRead}=await partial.read(buffer,0,Math.min(buffer.length,prefix-position),position);
          return bytesRead;
        }
        const chunk=chunks.find(item=>position>=item.offset&&position<item.offset+item.length);
        if(!chunk)throw fail('上传尚未完成',409);
        let handle=handles.get(chunk.offset);
        if(!handle){
          handle=await fs.open(join(meta.paths.chunks,String(chunk.offset)),constants.O_RDONLY|constants.O_NOFOLLOW);
          handles.set(chunk.offset,handle);
        }
        const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,chunk.offset+chunk.length-position),position-chunk.offset);
        return bytesRead;
      },
      async close(){
        await partial.close();
        await Promise.all([...handles.values()].map(handle=>handle.close()));
      }};
  }
  async function commit({uploadId}={}){
    const id=sessionId(uploadId);
    const state=lane(id);
    if(state.committing||state.aborting)throw fail('上传已结束',409);
    state.committing=true;
    let published=false;
    try{
      while(state.inflight>0)await new Promise(resolve=>state.waiters.push(resolve));
      const meta=await readMeta(id);
      const info=await describe(meta);
      if(info.offset!==meta.size||info.receivedBytes!==meta.size)throw conflict(info,'上传尚未完成');
      const reader=await logicalReader(meta);
      try{
        const result=await installRegularFile(meta.path,meta.size,reader.read);
        await reader.close();
        await removeSession(id);
        lanes.delete(id);
        published=true;
        return result;
      }catch(error){await reader.close();throw error;}
    }finally{if(!published)state.committing=false;}
  }
  async function abort({uploadId}={}){
    const id=sessionId(uploadId);
    const state=lane(id);
    state.aborting=true;
    while(state.inflight>0)await new Promise(resolve=>state.waiters.push(resolve));
    await removeSession(id);
    lanes.delete(id);
    return {uploadId:id,aborted:true};
  }
  async function mkdir({path}={}){
    return ensureRealDirectory(path);
  }
  async function stat(input){
    const requested=typeof input==='string'?input:input?.path;
    const path=filePath(requested);
    let real;
    try{real=await fs.realpath(path);}catch(error){mapFileError(error);}
    const handle=await fs.open(real,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const stats=await handle.stat();
      if(!stats.isFile())throw fail('只能下载普通文件',415);
      return {path:real,size:stats.size,modifiedAt:stats.mtime.toISOString(),name:basename(path)};
    }finally{await handle.close();}
  }
  async function read({path,offset,length}={}){
    const info=await stat(path);
    if(!Number.isInteger(offset)||offset<0||offset>info.size||!Number.isInteger(length)||
      length<1||length>boundedChunk||offset+length>info.size)throw fail('范围无效',416);
    const handle=await fs.open(info.path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const stream=handle.createReadStream({start:offset,end:offset+length-1,autoClose:true});
    return {result:{size:info.size,length,modifiedAt:info.modifiedAt},stream};
  }
  async function streamRange(path,range){
    const info=await stat(path);
    if(range.length===0)return {info,stream:Readable.from([])};
    if(range.start<0||range.end>=info.size||range.end<range.start)throw fail('范围无效',416);
    const handle=await fs.open(info.path,constants.O_RDONLY|constants.O_NOFOLLOW);
    return {info,stream:handle.createReadStream({start:range.start,end:range.end,autoClose:true})};
  }
  async function dispatch(input,stream){
    try{
      guard();
      if(!input||typeof input.op!=='string')throw fail('未知的文件传输操作',404);
      if(input.op==='open')return {result:await open(input)};
      if(input.op==='status')return {result:await status(input)};
      if(input.op==='write')return {result:await write(input,stream)};
      if(input.op==='commit')return {result:await commit(input)};
      if(input.op==='abort')return {result:await abort(input)};
      if(input.op==='mkdir')return {result:await mkdir(input)};
      if(input.op==='stat')return {result:await stat(input)};
      if(input.op==='read')return read(input);
      throw fail('未知的文件传输操作',404);
    }catch(error){mapFileError(error);}
  }
  return {open,status,write,commit,abort,mkdir,stat,read,streamRange,dispatch,sweep,chunkSize:boundedChunk};
}
