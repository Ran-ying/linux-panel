<script setup>
import {ref,watch,onUnmounted} from 'vue';
const props=defineProps({initialData:Object,listAction:String,operations:Object,csrf:String});
const emit=defineEmits(['path-change','unauthorized']);
const listing=ref(props.initialData),address=ref(props.initialData.path),editor=ref(null),content=ref(''),dirty=ref(false);
const busy=ref(false),error=ref(''),message=ref(''),uploadInput=ref(null);
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
  address.value=result.path;emit('path-change',result.path);
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
function upload(event){
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  return task(async()=>{
    if(file.size>8*1024*1024)throw new Error('上传文件超过 8 MiB');
    await request(props.operations.upload,{path:join(file.name),contentBase64:base64(await file.arrayBuffer())});
    await list(listing.value.path);message.value='上传完成';
  });
}
</script>
<template>
  <div class="file-browser">
    <form class="file-path-bar" @submit.prevent="task(()=>list(address))">
      <label>目录路径<input v-model="address" aria-label="目录路径" :disabled="busy" /></label>
      <button type="submit" :disabled="busy">打开目录</button>
      <button type="button" :disabled="busy || !listing.parent" @click="task(()=>list(listing.parent))">上一级</button>
      <button type="button" :disabled="busy" @click="uploadInput.click()">上传文件</button>
      <input ref="uploadInput" class="file-upload-input" type="file" aria-label="上传文件" @change="upload" />
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" class="notice success-notice" role="status">{{ message }}</p>
    <p v-if="busy" class="muted small" role="status">正在处理…</p>
    <div class="table-wrap">
      <table class="file-table">
        <thead><tr><th>名称</th><th>类型</th><th>大小</th><th>修改时间</th></tr></thead>
        <tbody>
          <tr v-for="entry in listing.entries" :key="entry.name">
            <td><button type="button" class="file-entry" :disabled="busy || entry.type==='other'" @click="open(entry)">{{ entry.name }}{{ entry.type==='directory'?'/':'' }}</button></td>
            <td>{{ entry.type==='directory'?'目录':entry.type==='file'?'文件':'其他' }}{{ entry.symlink?' · 链接':'' }}</td>
            <td>{{ entry.type==='directory'?'—':entry.size.toLocaleString()+' B' }}</td><td>{{ entry.modifiedAt }}</td>
          </tr>
          <tr v-if="!listing.entries.length"><td colspan="4">空目录</td></tr>
        </tbody>
      </table>
    </div>
    <p class="muted small">已显示 {{ listing.entries.length }} / {{ listing.total }} 项</p>
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
