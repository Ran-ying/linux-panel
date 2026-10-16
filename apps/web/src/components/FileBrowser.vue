<script setup>
import {ref,watch,onUnmounted} from 'vue';
const props=defineProps({initialData:Object,listAction:String,operations:Object,csrf:String});
const emit=defineEmits(['path-change','listing-change','unauthorized']);
const listing=ref(props.initialData),address=ref(props.initialData.path),editor=ref(null),content=ref(''),dirty=ref(false);
const busy=ref(false),error=ref(''),message=ref(''),uploadInput=ref(null);
const dragging=ref(false),operation=ref(null),entryName=ref('');
const controller=new AbortController();
watch(()=>props.initialData,data=>{listing.value=data;address.value=data.path;});
onUnmounted(()=>controller.abort());
async function request(action,input){
  const response=await fetch('/api/actions/'+encodeURIComponent(action)+'/execute',{
    method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
    body:JSON.stringify({input})});
  const body=await response.json();
  if(response.status===401)emit('unauthorized');
  if(!response.ok)throw new Error(body.error || 'HTTP '+response.status);
  return body.result;
}
async function task(fn){
  if(busy.value)return;
  busy.value=true;error.value='';message.value='';
  try{await fn();}catch(cause){if(cause.name!=='AbortError')error.value=cause.message;}
  finally{busy.value=false;}
}
async function list(path,more=false){
  const result=await request(props.listAction,{path,...(more?{offset:listing.value.nextOffset}:{})});
  listing.value=more?{...result,entries:[...listing.value.entries,...result.entries]}:result;
  address.value=result.path;emit('path-change',result.path);emit('listing-change',listing.value);
}
function open(entry){
  if(entry.type==='directory')return task(()=>list(join(entry.name)));
  if(entry.type!=='file')return;
  if(dirty.value && !window.confirm('放弃尚未保存的编辑？'))return;
  return task(async()=>{editor.value=await request(props.operations.read,{path:join(entry.name)});
    content.value=editor.value.content;dirty.value=false;});
}
function join(name){return (listing.value.path==='/'?'':listing.value.path)+'/'+name;}
function closeEditor(){
  if(dirty.value && !window.confirm('放弃尚未保存的编辑？'))return;
  editor.value=null;dirty.value=false;
}
function save(){return task(async()=>{
  const result=await request(props.operations.write,{path:editor.value.path,content:content.value,revision:editor.value.revision});
  editor.value={...editor.value,...result};dirty.value=false;message.value='已保存';await list(listing.value.path);
});}
function base64(buffer){
  const bytes=new Uint8Array(buffer);let value='';
  for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(value);
}
function upload(event){const files=Array.from(event.target.files || []);event.target.value='';return uploadFiles(files);}
function drop(event){dragging.value=false;return uploadFiles(Array.from(event.dataTransfer.files || []));}
function uploadFiles(files){
  if(!files.length)return;
  return task(async()=>{
    try{
      for(const file of files){
        if(file.size>8*1024*1024)throw new Error(file.name+' 超过 8 MiB');
        await request(props.operations.upload,{path:join(file.name),contentBase64:base64(await file.arrayBuffer())});
      }
      message.value='上传完成';
    }finally{await list(listing.value.path);}
  });
}
function beginCreate(type){operation.value={kind:'create',type};entryName.value='';}
function beginRename(entry){operation.value={kind:'rename',entry};entryName.value=entry.name;}
function submitEntry(){return task(async()=>{
  const name=entryName.value.trim();
  if(!name || name==='.' || name==='..' || name.includes('/') || name.includes('\0'))throw new Error('请输入有效名称，不能包含 /');
  const current=operation.value;
  if(current.kind==='create')await request(props.operations.create,{path:join(name),type:current.type});
  else{
    const oldPath=join(current.entry.name),newPath=join(name);
    await request(props.operations.rename,{path:oldPath,newPath});
    if(editor.value && (editor.value.path===oldPath || editor.value.path.startsWith(oldPath+'/')))
      editor.value.path=newPath+editor.value.path.slice(oldPath.length);
  }
  operation.value=null;await list(listing.value.path);message.value=current.kind==='create'?'已新建':'已重命名';
});}
function remove(entry){
  const path=join(entry.name);
  if(!window.confirm('删除 '+path+'？'+(entry.type==='directory' && !entry.symlink?'目录内所有内容也会删除。':'')+'此操作无法撤销。'))return;
  return task(async()=>{
    await request(props.operations.delete,{path});
    if(editor.value && (editor.value.path===path || !entry.symlink && editor.value.path.startsWith(path+'/'))){editor.value=null;dirty.value=false;}
    await list(listing.value.path);message.value='已删除';
  });
}
function megabytes(entry){
  if(entry.size===null)return '—';
  return (entry.sizeComplete?'':'≥ ')+(entry.size/1000000).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:6})+' MB';
}
</script>
<template>
  <div class="file-browser" :class="{'file-dragging':dragging}" @dragover.prevent="dragging=true"
    @dragleave="!$event.currentTarget.contains($event.relatedTarget) && (dragging=false)" @drop.prevent="drop">
    <form class="file-path-bar" @submit.prevent="task(()=>list(address))">
      <label>目录路径<input v-model="address" aria-label="目录路径" :disabled="busy" /></label>
      <button type="submit" :disabled="busy">打开目录</button>
      <button type="button" :disabled="busy || !listing.parent" @click="task(()=>list(listing.parent))">上一级</button>
      <button type="button" :disabled="busy" @click="uploadInput.click()">上传文件</button>
      <input ref="uploadInput" class="file-upload-input" type="file" multiple aria-label="上传文件" @change="upload" />
    </form>
    <div class="file-toolbar">
      <button type="button" :disabled="busy" @click="beginCreate('file')">新建文件</button>
      <button type="button" :disabled="busy" @click="beginCreate('directory')">新建文件夹</button>
      <span class="muted small">可将文件拖入此处上传</span>
    </div>
    <div v-if="dragging" class="file-drop-hint">松开以上传到当前目录</div>
    <form v-if="operation" class="file-entry-form" @submit.prevent="submitEntry">
      <label>{{ operation.kind==='rename'?'重命名':operation.type==='file'?'新建文件':'新建文件夹' }}
        <input v-model="entryName" aria-label="名称" required :disabled="busy" /></label>
      <button type="submit" :disabled="busy">确定</button>
      <button type="button" :disabled="busy" @click="operation=null">取消</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="notice success-notice" role="status">{{ message }}</p>
    <p v-if="busy" class="muted small" role="status">正在处理…</p>
    <div class="table-wrap">
      <table class="file-table">
        <thead><tr><th>名称</th><th>类型</th><th>大小（MB）</th><th>权限 / 所有者</th><th>修改时间</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="entry in listing.entries" :key="entry.name">
            <td><button type="button" class="file-entry" :disabled="busy || entry.type==='other'" @click="open(entry)">{{ entry.name }}{{ entry.type==='directory'?'/':'' }}</button></td>
            <td>{{ entry.type==='directory'?'目录':entry.type==='file'?'文件':'其他' }}{{ entry.symlink?' · 链接':'' }}</td>
            <td :title="entry.sizeComplete?'逻辑文件大小，1 MB = 1,000,000 B':'未完整统计；可能无权限、超过扫描限额或为目录链接'">{{ megabytes(entry) }}</td>
            <td><span class="file-permissions">{{ entry.permissions }}</span><span class="file-owner">{{ entry.owner }}</span></td>
            <td>{{ entry.modifiedAt }}</td>
            <td><div class="file-row-actions">
              <button type="button" :disabled="busy" :aria-label="'重命名 '+entry.name" @click="beginRename(entry)">重命名</button>
              <button type="button" :disabled="busy" :aria-label="'删除 '+entry.name" @click="remove(entry)">删除</button>
            </div></td>
          </tr>
          <tr v-if="!listing.entries.length"><td colspan="6">空目录</td></tr>
        </tbody>
      </table>
    </div>
    <p class="muted small">已显示 {{ listing.entries.length }} / {{ listing.total }} 项</p>
    <p v-if="listing.entries.some(entry=>!entry.sizeComplete)" class="muted small">≥ 表示仅统计到部分内容；— 表示无法统计。文件夹大小不包含符号链接目标。</p>
    <button v-if="listing.nextOffset!==null" type="button" :disabled="busy" @click="task(()=>list(listing.path,true))">加载更多</button>
    <div v-if="editor" class="file-editor">
      <strong>{{ editor.path }}</strong>
      <textarea v-model="content" aria-label="文件内容" rows="16" spellcheck="false" :disabled="busy" @input="dirty=true" />
      <div class="file-editor-controls">
        <button type="button" :disabled="busy || !dirty" @click="save">保存文件</button>
        <button type="button" :disabled="busy" @click="closeEditor">关闭编辑</button>
        <span v-if="dirty" class="muted small">尚未保存</span>
      </div>
    </div>
  </div>
</template>
