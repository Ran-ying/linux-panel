// Browser-side drop enumeration. Capture DataTransferItem handles while the
// drop event is active: some browsers hide dataTransfer.items after the event.
export const MAX_DROP_ENTRIES=3000;
export const MAX_DROP_DEPTH=32;

export function safeRelativePath(input){
  if(typeof input!=='string'||!input||input.length>2048||
    input.startsWith('/')||input.includes('\\')||input.includes('\0'))throw Error('拖入内容包含无效路径');
  const segments=input.split('/');
  if(segments.some(part=>!part||part==='.'||part==='..'||part.length>255||
    /[\u0000-\u001f\u007f]/.test(part)))
    throw Error('拖入内容包含无效文件名或目录层级');
  return input;
}
function entryPath(prefix,name){return safeRelativePath(prefix?prefix+'/'+name:name);}
function callbackFile(entry){
  return new Promise((resolve,reject)=>entry.file(resolve,reject));
}
function callbackEntries(reader){
  return new Promise((resolve,reject)=>reader.readEntries(resolve,reject));
}
export async function walkDropSources(sources,{maxEntries=MAX_DROP_ENTRIES,maxDepth=MAX_DROP_DEPTH}={}){
  const entries=[],seen=new Set();
  async function add(item){
    if(entries.length>=maxEntries)throw Error('拖入项目过多，请分批上传（最多 '+maxEntries+' 项）');
    if(seen.has(item.relativePath))throw Error('拖入内容包含重复的文件路径');
    seen.add(item.relativePath);entries.push(item);
  }
  async function traverse(source,prefix='',depth=0){
    if(depth>maxDepth)throw Error('文件夹嵌套层级过深，请分批上传');
    if(source.type==='file'){
      const name=source.name??source.file?.name;
      const path=entryPath(prefix,name);
      const file=source.file?await source.file:source.handle?await source.handle.getFile():await callbackFile(source.entry);
      if(!file)throw Error('无法读取拖入文件 '+path);
      await add({type:'file',relativePath:path,file});
      return;
    }
    if(source.type==='directory'){
      const path=entryPath(prefix,source.name);
      await add({type:'directory',relativePath:path});
      if(source.handle){
        for await(const child of source.handle.values()){
          await traverse(child.kind==='directory'
            ?{type:'directory',name:child.name,handle:child}
            :{type:'file',name:child.name,file:await child.getFile()},path,depth+1);
        }
      }else{
        const reader=source.entry.createReader();
        // Chromium returns large folders in multiple batches; read until empty.
        let batches=0;
        while(true){
          if(++batches>maxEntries)throw Error('目录读取次数过多，已中止');
          const children=await callbackEntries(reader);
          if(!children?.length)break;
          for(const child of children){
            await traverse(child.isDirectory
              ?{type:'directory',name:child.name,entry:child}
              :{type:'file',name:child.name,entry:child},path,depth+1);
        }
      }
    }
  }
  }
  for(const source of sources)await traverse(source);
  return entries;
}
export function collectDroppedItems(transfer){
  if(!transfer) return Promise.resolve([]);
  const items=Array.from(transfer.items||[]);
  const sources=[],handlePromises=[];
  if(items.length){
    for(const item of items){
      if(item.kind!=='file')continue;
      const entry=typeof item.webkitGetAsEntry==='function'?item.webkitGetAsEntry():null;
      if(entry){
        sources.push(entry.isDirectory
          ?{type:'directory',name:entry.name,entry}
          :{type:'file',name:entry.name,entry});
      }else if(typeof item.getAsFileSystemHandle==='function'){
        // Call while inside the user-initiated drop, before any await.
        const fallback=item.getAsFile?.();
        let handlePromise;
        try{handlePromise=item.getAsFileSystemHandle();}
        catch{handlePromise=null;}
        handlePromises.push(Promise.resolve(handlePromise).catch(()=>null).then(handle=>
          handle??(fallback?{kind:'file',name:fallback.name,file:fallback}:null)));
      }else{
        const file=item.getAsFile?.();
        if(file)sources.push({type:'file',name:file.name,file});
      }
    }
  }
  if(!sources.length&&!handlePromises.length){
    for(const file of Array.from(transfer.files||[])){
      sources.push({type:'file',name:file.name,file});
    }
  }
  return Promise.all(handlePromises).then(handles=>walkDropSources([
    ...sources,...handles.filter(Boolean).map(handle=>handle.kind==='directory'
      ?{type:'directory',name:handle.name,handle}
      :handle.file?{type:'file',name:handle.name,file:handle.file}
        :{type:'file',name:handle.name,handle})
  ]));
}
export function collectSelectedFiles(files){
  return Array.from(files||[]).map(file=>({
    type:'file',relativePath:safeRelativePath(file.webkitRelativePath||file.name),file
  }));
}
