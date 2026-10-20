// Read dropped files & directories in a browser without sending any local paths
// to the server. All directory entries are captured during the drop event.
// Prefer modern File System Access handles when available; older browsers
// retain the webkitGetAsEntry traversal and ordinary File fallback.
export const MAX_DROP_ENTRIES=3000;
export const MAX_DROP_DEPTH=32;

export function safeRelativePath(input){
  if(typeof input!=='string'||!input||input.length>2048||
    input.startsWith('/')||input.includes('\\')||input.includes('\0'))
    throw Error('拖入内容包含无效路径');
  const segments=input.split('/');
  if(segments.some(part=>!part||part==='.'||part==='..'||part.length>255||
    /[\u0000-\u001f\u007f]/.test(part)))
    throw Error('拖入内容包含无效文件名或目录层级');
  return input;
}
function childPath(prefix,name){return safeRelativePath(prefix?prefix+'/'+name:name);}
function readWebkitFile(entry){
  return new Promise((resolve,reject)=>entry.file(resolve,reject));
}
function readWebkitBatch(reader){
  return new Promise((resolve,reject)=>reader.readEntries(resolve,reject));
}
const unavailableMessage=(cause)=>{
  const name=cause?.name;
  return name==='NotFoundError'||name==='NotReadableError'
    ?'浏览器无法读取此文件或文件夹，请确认文件在本机可用并重试'
    :'浏览器读取失败：'+(cause?.message||'未知错误');
};

export async function walkDropSources(sources,{maxEntries=MAX_DROP_ENTRIES,maxDepth=MAX_DROP_DEPTH}={}){
  const results=[],seen=new Set();
  function add(item){
    if(results.length>=maxEntries)
      throw Error('拖入项目过多，请分批上传（最多 '+maxEntries+' 项）');
    if(seen.has(item.relativePath))
      throw Error('拖入内容包含重复的文件路径');
    seen.add(item.relativePath);
    results.push(item);
  }
  function errorItem(path,cause){
    add({type:'error',relativePath:path,message:unavailableMessage(cause)});
  }
  async function traverse(source,prefix='',depth=0){
    if(depth>maxDepth)throw Error('文件夹嵌套层级过深，请分批上传');
    const path=childPath(prefix,source.name);
    if(source.type==='file'){
      try{
        let file;
        if(source.handle){
          try{file=await source.handle.getFile();}
          catch(cause){
            if(source.entry)file=await readWebkitFile(source.entry);
            else if(source.fallbackFile)file=source.fallbackFile;
            else throw cause;
          }
        }else file=source.file?await source.file:await readWebkitFile(source.entry);
        if(!file)throw Error('读取结果为空');
        add({type:'file',relativePath:path,file});
      }catch(cause){
        errorItem(path,cause);
      }
      return;
    }
    if(source.type!=='directory')throw Error('不支持的拖入项目');
    add({type:'directory',relativePath:path});
    let useLegacy=!source.handle;
    if(source.handle){
      const before=results.length;
      try{
        for await(const child of source.handle.values()){
          await traverse(child.kind==='directory'
            ?{type:'directory',name:child.name,handle:child}
            :{type:'file',name:child.name,handle:child},path,depth+1);
        }
      }catch(cause){
        if(/^(拖入内容|拖入项目过多|文件夹嵌套层级过深)/.test(cause?.message||''))throw cause;
        // A legacy entry can rescue a modern handle that wasn't usable.
        // Only restart enumeration when nothing was traversed, avoiding
        // duplicate uploads after a partially successful traversal.
        if(source.entry&&results.length===before)useLegacy=true;
        else errorItem(path+'/（读取失败）',cause);
      }
    }
    if(useLegacy){
      let reader;
      try{reader=source.entry.createReader();}
      catch(cause){errorItem(path+'/（读取失败）',cause);return;}
      let count=0;
      while(true){
        let children;
        try{
          if(++count>maxEntries)throw Error('目录枚举超过最大次数');
          children=await readWebkitBatch(reader);
        }catch(cause){
          errorItem(path+'/（读取失败）',cause);
          break;
        }
        if(!children?.length)break;
        for(const child of children){
          await traverse(child.isDirectory
            ?{type:'directory',name:child.name,entry:child}
            :{type:'file',name:child.name,entry:child},path,depth+1);
        }
      }
    }
  }
  for(const source of sources)await traverse(source);
  return results;
}

export function collectDroppedItems(transfer){
  if(!transfer)return Promise.resolve([]);
  const items=Array.from(transfer.items||[]);
  const captures=[];
  for(const item of items){
    if(item.kind!=='file')continue;
    // Capture entry, fallback File and start getAsFileSystemHandle *synchronously*
    // before the user-gesture drop event ends. Await afterward.
    let entry=null,file=null,handle=null;
    try{entry=item.getAsEntry?.()??item.webkitGetAsEntry?.()??null;}
    catch{/* unsupported legacy API */}
    try{file=item.getAsFile?.()??null;}
    catch{/* directory or inaccessible file */}
    try{handle=item.getAsFileSystemHandle?.()??null;}
    catch{/* not supported outside a secure context */}
    if(!entry&&!file&&!handle)continue;
    captures.push(Promise.resolve(handle).catch(()=>null).then(resolved=>{
      if(resolved){
        return resolved.kind==='directory'
          ?{type:'directory',name:resolved.name,handle:resolved,entry}
          :{type:'file',name:resolved.name,handle:resolved,entry,fallbackFile:file};
      }
      if(entry)return entry.isDirectory
        ?{type:'directory',name:entry.name,entry}
        :{type:'file',name:entry.name,entry};
      return file?{type:'file',name:file.name,file}:null;
    }));
  }
  if(!captures.length){
    for(const file of Array.from(transfer.files||[]))
      captures.push(Promise.resolve({type:'file',name:file.name,file}));
  }
  return Promise.all(captures).then(sources=>walkDropSources(sources.filter(Boolean)));
}
export function collectSelectedFiles(files){
  const entries=[],directories=new Set();
  for(const file of Array.from(files||[])){
    const path=safeRelativePath(file.webkitRelativePath||file.name);
    const names=path.split('/');
    for(let i=1;i<names.length;i++){
      const folder=names.slice(0,i).join('/');
      if(!directories.has(folder)){
        directories.add(folder);
        entries.push({type:'directory',relativePath:folder});
      }
    }
    entries.push({type:'file',relativePath:path,file});
    if(entries.length>MAX_DROP_ENTRIES)
      throw Error('选择的项目过多，请分批上传（最多 '+MAX_DROP_ENTRIES+' 项）');
  }
  return entries;
}
