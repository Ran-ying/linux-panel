// Browser-side chunked upload. File.slice streams one chunk at a time; the
// whole file is never read into memory. Several files, and several chunks of
// one file, share a bounded pool. A saved upload id lets a later attempt
// continue from the bytes the server already has.
export const DEFAULT_UPLOAD_CONCURRENCY=3;

export function createTransferLimiter(limit=DEFAULT_UPLOAD_CONCURRENCY){
  const size=Math.max(1,limit);
  let active=0;
  const queue=[];
  const kick=()=>{
    while(active<size&&queue.length){
      const job=queue.shift();
      active++;
      job.run().then(job.resolve,job.reject).finally(()=>{active--;kick();});
    }
  };
  return function limitRun(run){
    return new Promise((resolve,reject)=>{
      queue.push({run,resolve,reject});
      kick();
    });
  };
}
function parentPath(relative){
  const index=relative.lastIndexOf('/');
  return index===-1?'':relative.slice(0,index);
}
function abortError(){
  const error=Error('上传已取消');
  error.name='AbortError';
  return error;
}
export async function uploadFile({file,path,csrf,storage,signal,onProgress,fetchImpl=globalThis.fetch,
  limiter,concurrency=DEFAULT_UPLOAD_CONCURRENCY}){
  const limit=limiter||createTransferLimiter(concurrency);
  const key='lp-upload:'+path+'\0'+file.size+'\0'+file.lastModified;
  const open=async id=>{
    const response=await fetchImpl('/api/files/uploads',{
      method:'POST',signal,headers:{'Content-Type':'application/json','X-Panel-CSRF':csrf},
      body:JSON.stringify({path,size:file.size,...(id?{uploadId:id}:{})})
    });
    const body=await response.json().catch(()=>({}));
    if(response.status===404&&id)return open('');
    if(!response.ok)throw Error(body.error||'无法开始上传');
    return body;
  };
  const session=await open(storage?.getItem(key)||'');
  if(!session.uploadId||!Number.isInteger(session.chunkSize)||session.chunkSize<1)
    throw Error('服务器没有返回有效的上传会话');
  storage?.setItem(key,session.uploadId);
  const own=new AbortController();
  const stop=()=>own.abort(signal?.reason);
  if(signal?.aborted)own.abort(signal.reason);
  else signal?.addEventListener('abort',stop,{once:true});
  let loaded=Number.isInteger(session.receivedBytes)?session.receivedBytes:session.offset||0;
  const report=()=>onProgress?.({loaded,total:file.size});
  const note=(body,length)=>{
    loaded=Number.isInteger(body?.receivedBytes)?Math.max(loaded,body.receivedBytes):Math.min(file.size,loaded+length);
    report();
  };
  report();
  try{
    let cursor=session.offset||0;
    while(cursor<file.size&&cursor%session.chunkSize!==0){
      if(own.signal.aborted)throw abortError();
      const boundary=cursor+session.chunkSize-(cursor%session.chunkSize);
      const length=Math.min(file.size,boundary)-cursor;
      const body=await limit(()=>sendChunk({fetchImpl,csrf,signal:own.signal,uploadId:session.uploadId,
        offset:cursor,blob:file.slice(cursor,cursor+length)}));
      note(body,length);
      if(!Number.isInteger(body.offset)||body.offset<cursor+length||body.offset>file.size)
        throw Error('上传偏移无效');
      cursor=body.offset;
    }
    const tasks=[];
    for(let offset=cursor;offset<file.size;offset+=session.chunkSize){
      const chunkOffset=offset;
      const end=Math.min(file.size,offset+session.chunkSize);
      tasks.push(limit(async()=>{
        if(own.signal.aborted)throw abortError();
        const body=await sendChunk({fetchImpl,csrf,signal:own.signal,uploadId:session.uploadId,
          offset:chunkOffset,blob:file.slice(chunkOffset,end)});
        note(body,end-chunkOffset);
      }));
    }
    try{await Promise.all(tasks);}
    catch(error){own.abort();await Promise.allSettled(tasks);throw error;}
    if(own.signal.aborted)throw abortError();
    const done=await fetchImpl('/api/files/uploads/'+session.uploadId+'/complete',{
      method:'POST',signal:own.signal,headers:{'Content-Type':'application/json','X-Panel-CSRF':csrf},body:'{}'
    });
    const body=await done.json().catch(()=>({}));
    if(!done.ok)throw Error(body.error||'上传提交失败');
    storage?.removeItem(key);
    return body;
  }finally{signal?.removeEventListener('abort',stop);}
}
async function sendChunk({fetchImpl,csrf,signal,uploadId,offset,blob}){
  let lastError=Error('上传失败');
  for(let attempt=0;attempt<5;attempt++){
    try{
      const response=await fetchImpl('/api/files/uploads/'+uploadId,{
        method:'PATCH',signal,
        headers:{'Content-Type':'application/octet-stream','Upload-Offset':String(offset),'X-Panel-CSRF':csrf},
        body:blob
      });
      const body=await response.json().catch(()=>({}));
      if(response.ok&&Number.isInteger(body.offset))return body;
      if(response.status===409&&Number.isInteger(body.offset)&&body.offset>=offset+blob.size)return body;
      lastError=Error(body.error||'上传失败');
      if(response.status===429){
        await new Promise(resolve=>setTimeout(resolve,40*(attempt+1)));
        continue;
      }
      if(response.status<500)throw lastError;
    }catch(error){
      if(error?.name==='AbortError')throw error;
      lastError=error;
    }
    try{
      const status=await fetchImpl('/api/files/uploads/'+uploadId,{signal});
      const progress=await status.json().catch(()=>({}));
      if(status.ok&&Number.isInteger(progress.offset)&&progress.offset>=offset+blob.size)return progress;
    }catch(error){if(error?.name==='AbortError')throw error;}
  }
  throw lastError;
}
export async function ensureDirectory({path,csrf,signal,fetchImpl=globalThis.fetch}){
  const response=await fetchImpl('/api/files/directories',{
    method:'POST',signal,headers:{'Content-Type':'application/json','X-Panel-CSRF':csrf},
    body:JSON.stringify({path})
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error||'无法创建文件夹');
  return body;
}
// Directories are created parent-first. Files and chunks share `limiter`,
// and a failed directory blocks only its descendants.
export async function runUploadPlan({entries,signal,limiter,concurrency=DEFAULT_UPLOAD_CONCURRENCY,createDirectory,upload}){
  const limit=limiter||createTransferLimiter(concurrency);
  const failed=new Set();
  const dirJobs=new Map();
  const ancestorFailed=relative=>{
    const parts=relative.split('/');
    let path='';
    for(let index=0;index<parts.length-1;index++){
      path=path?path+'/'+parts[index]:parts[index];
      if(failed.has(path))return true;
    }
    return false;
  };
  function dirJob(relative){
    if(dirJobs.has(relative))return dirJobs.get(relative);
    const parent=parentPath(relative);
    const job=(async()=>{
      if(signal?.aborted)throw abortError();
      if(parent)await dirJob(parent);
      if(ancestorFailed(relative))throw Error('父目录创建失败');
      await limit(()=>createDirectory(relative));
    })().catch(error=>{failed.add(relative);throw error;});
    dirJobs.set(relative,job);
    return job;
  }
  for(const entry of entries)if(entry.type==='directory')dirJob(entry.relativePath);
  const settled=await Promise.allSettled(entries.map(async entry=>{
    try{
      if(signal?.aborted)throw abortError();
      if(entry.type==='directory'){await dirJob(entry.relativePath);return {entry,ok:true};}
      const parent=parentPath(entry.relativePath||'');
      if(parent){
        try{await dirJob(parent);}
        catch(error){
          if(error?.name==='AbortError')throw error;
          return {entry,ok:false,skipped:true,error:Error('父目录创建失败')};
        }
      }
      if(ancestorFailed(entry.relativePath||''))return {entry,ok:false,skipped:true,error:Error('父目录创建失败')};
      if(entry.type==='file'){await upload(entry,limit);return {entry,ok:true};}
      return {entry,ok:false,error:Error(entry.message||'无法读取拖入文件')};
    }catch(error){
      if(error?.name==='AbortError')throw error;
      return {entry,ok:false,error};
    }
  }));
  const aborted=settled.find(item=>item.status==='rejected');
  if(aborted)throw aborted.reason;
  return {results:settled.map(item=>item.value),failed};
}
