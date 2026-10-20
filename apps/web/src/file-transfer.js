// Browser-side chunked upload. File.slice streams one chunk at a time; the
// whole file is never read into memory. A saved upload id lets a later attempt
// continue from the bytes the server already has.
export async function uploadFile({file,path,csrf,storage,signal,onProgress,fetchImpl=globalThis.fetch}){
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
  let offset=session.offset||0;
  const report=()=>onProgress?.({loaded:offset,total:file.size});
  report();
  while(offset<file.size){
    const end=Math.min(file.size,offset+session.chunkSize);
    const next=await sendChunk({fetchImpl,csrf,signal,uploadId:session.uploadId,offset,
      blob:file.slice(offset,end)});
    if(!Number.isInteger(next)||next<=offset||next>file.size)throw Error('上传偏移无效');
    offset=next;
    report();
  }
  const done=await fetchImpl('/api/files/uploads/'+session.uploadId+'/complete',{
    method:'POST',signal,headers:{'Content-Type':'application/json','X-Panel-CSRF':csrf},body:'{}'
  });
  const body=await done.json().catch(()=>({}));
  if(!done.ok)throw Error(body.error||'上传提交失败');
  storage?.removeItem(key);
  return body;
}
async function sendChunk({fetchImpl,csrf,signal,uploadId,offset,blob}){
  let lastError=Error('上传失败');
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetchImpl('/api/files/uploads/'+uploadId,{
        method:'PATCH',signal,
        headers:{'Content-Type':'application/octet-stream','Upload-Offset':String(offset),'X-Panel-CSRF':csrf},
        body:blob
      });
      const body=await response.json().catch(()=>({}));
      if(response.status===409&&Number.isInteger(body.offset))return body.offset;
      if(response.ok&&Number.isInteger(body.offset))return body.offset;
      lastError=Error(body.error||'上传失败');
      if(response.status<500)throw lastError;
    }catch(error){
      if(error?.name==='AbortError')throw error;
      lastError=error;
    }
    try{
      const status=await fetchImpl('/api/files/uploads/'+uploadId,{signal});
      const progress=await status.json().catch(()=>({}));
      if(status.ok&&Number.isInteger(progress.offset)&&progress.offset>offset)return progress.offset;
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
