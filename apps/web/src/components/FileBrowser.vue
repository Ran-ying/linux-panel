<script setup>
import {ref,watch,onUnmounted,computed,nextTick} from 'vue';
const props=defineProps({initialData:Object,listAction:String,operations:Object,csrf:String});
const emit=defineEmits(['path-change','listing-change','unauthorized']);
const listing=ref(props.initialData),address=ref(props.initialData.path),editor=ref(null),content=ref(''),dirty=ref(false);
const busy=ref(false),error=ref(''),message=ref(''),uploadInput=ref(null);
const actionDialog=ref(null),accounts=ref(null),accountsLoading=ref(false),accountsError=ref('');
let notificationTimer;
const dragging=ref(false),operation=ref(null),entryName=ref('');
const permissionForm=ref({mode:'',owner:'',group:''});
const canWrite=computed(()=>listing.value.writeAccess==='allowed');
const controller=new AbortController();
watch(()=>props.initialData,data=>{listing.value=data;address.value=data.path;});
onUnmounted(()=>{controller.abort();clearTimeout(notificationTimer);});
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
  busy.value=true;error.value='';message.value='';clearTimeout(notificationTimer);
  try{const notice=await fn();if(typeof notice==='string'){
    message.value=notice;
    notificationTimer=setTimeout(()=>{message.value='';},3200);
  }}
  catch(cause){if(cause.name!=='AbortError')error.value=cause.message;}
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
  editor.value={...editor.value,...result};dirty.value=false;await list(listing.value.path);return '已保存';
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
  if(!canWrite.value){error.value='当前目录不可写，请打开有写入权限的目录后上传';return;}
  return task(async()=>{
    try{
      for(const file of files){
        if(file.size>8*1024*1024)throw new Error(file.name+' 超过 8 MiB');
        await request(props.operations.upload,{path:join(file.name),contentBase64:base64(await file.arrayBuffer())});
      }
    }finally{await list(listing.value.path);}
    return '上传完成';
  });
}
function beginCreate(type){operation.value={kind:'create',type};entryName.value='';}
function closeDialog(){
  actionDialog.value?.close();
  operation.value=null;
}
function showDialog(kind,entry){
  operation.value={kind,entry};error.value='';
  nextTick(()=>actionDialog.value?.showModal());
}
function beginRename(entry){entryName.value=entry.name;showDialog('rename',entry);}
function beginDelete(entry){showDialog('delete',entry);}
function accountChoices(type,current){
  const choices=accounts.value?.[type] ?? [];
  return current && !choices.some(item=>item.name===current)
    ?[{name:current,id:null},...choices]:choices;
}
async function editPermissions(entry){
  const [owner,group]=entry.owner.split(':');
  permissionForm.value={mode:entry.permissions,owner,group};
  showDialog('permissions',entry);
  if(accounts.value || accountsLoading.value)return;
  accountsLoading.value=true;accountsError.value='';
  try{accounts.value=await request(props.operations.accounts,{});}
  catch(cause){if(cause.name!=='AbortError')accountsError.value='无法读取系统账户：'+cause.message;}
  finally{accountsLoading.value=false;}
}
function savePermissions(){return task(async()=>{
  const entry=operation.value.entry,path=join(entry.name),values=permissionForm.value;
  const [owner,group]=entry.owner.split(':');
  try{
    const input={path};
    if(values.owner!==owner)input.owner=values.owner.trim();
    if(values.group!==group)input.group=values.group.trim();
    if(Object.keys(input).length>1)await request(props.operations.chown,input);
    // chown may clear special mode bits; set the requested mode afterwards.
    if(!entry.symlink)await request(props.operations.chmod,{path,mode:values.mode});
    closeDialog();
  }finally{await list(listing.value.path);}
  return '权限与属主已保存';
});}
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
  if(current.kind==='rename')closeDialog();else operation.value=null;
  await list(listing.value.path);return current.kind==='create'?'已新建':'已重命名';
});}
function confirmDelete(){return task(async()=>{
  const entry=operation.value.entry,path=join(entry.name);
  await request(props.operations.delete,{path});
  if(editor.value && (editor.value.path===path || !entry.symlink && editor.value.path.startsWith(path+'/'))){editor.value=null;dirty.value=false;}
  closeDialog();await list(listing.value.path);return '已删除';
});}
function megabytes(entry){
  if(entry.size===null)return '—';
  return (entry.sizeComplete?'':'≥ ')+(entry.size/1000000).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+' MB';
}
function dateParts(value){
  const date=new Date(value);
  if(!value || Number.isNaN(date.getTime()))return null;
  return {date:date.toLocaleDateString('sv-SE'),time:date.toLocaleTimeString('zh-CN',{hour12:false})};
}
</script>
<template>
  <div class="file-browser" :class="{'file-dragging':dragging}" @dragover.prevent="dragging=true"
    @dragleave="!$event.currentTarget.contains($event.relatedTarget) && (dragging=false)" @drop.prevent="drop">
    <form class="file-path-bar" @submit.prevent="task(()=>list(address))">
      <button type="button" :disabled="busy || !listing.parent" @click="task(()=>list(listing.parent))">上一级</button>
      <input v-model="address" aria-label="目录路径" :disabled="busy" />
      <button type="submit" class="panel-control-primary" :disabled="busy">打开目录</button>
    </form>
    <div class="file-toolbar panel-control-capsule">
      <button type="button" class="panel-control-primary" :disabled="busy || !canWrite" @click="uploadInput.click()">上传文件</button>
      <input ref="uploadInput" class="file-upload-input" type="file" multiple aria-label="上传文件" :disabled="busy || !canWrite" @change="upload" />
      <button type="button" :disabled="busy || !canWrite" @click="beginCreate('file')">新建文件</button>
      <button type="button" :disabled="busy || !canWrite" @click="beginCreate('directory')">新建文件夹</button>
    </div>
    <p v-if="!canWrite" class="notice file-access-notice" role="status">{{ listing.writeAccess==='readonly'?'当前目录所在文件系统只读。':'面板服务账户没有当前目录的写入权限。' }}请打开可写目录后新建或上传文件。</p>
    <div v-if="dragging" class="file-drop-hint">松开以上传到当前目录</div>
    <form v-if="operation?.kind==='create'" class="file-entry-form" @submit.prevent="submitEntry">
      <label>{{ operation.type==='file'?'新建文件':'新建文件夹' }}
        <input v-model="entryName" aria-label="名称" required :disabled="busy" /></label>
      <button type="submit" :disabled="busy">确定</button>
      <button type="button" :disabled="busy" @click="operation=null">取消</button>
    </form>
    <dialog v-if="operation && operation.kind!=='create'" ref="actionDialog" class="file-action-dialog"
      aria-labelledby="file-dialog-title" @close="operation=null">
      <form v-if="operation.kind==='permissions'" class="file-dialog-body" @submit.prevent="savePermissions">
        <h3 id="file-dialog-title">修改权限与所有者</h3>
        <p class="file-dialog-target">{{ operation.entry.name }}</p>
        <label>权限（八进制）
          <input v-model="permissionForm.mode" aria-label="文件权限" pattern="[0-7]{3,4}" required :disabled="busy || operation.entry.symlink" />
        </label>
        <label>用户
          <select v-model="permissionForm.owner" aria-label="文件用户" :disabled="busy || accountsLoading">
            <option v-for="record in accountChoices('users',permissionForm.owner)" :key="record.name" :value="record.name">
              {{ record.name }}{{ record.id===null?'': ' ('+record.id+')' }}
            </option>
          </select>
        </label>
        <label>用户组
          <select v-model="permissionForm.group" aria-label="文件用户组" :disabled="busy || accountsLoading">
            <option v-for="record in accountChoices('groups',permissionForm.group)" :key="record.name" :value="record.name">
              {{ record.name }}{{ record.id===null?'': ' ('+record.id+')' }}
            </option>
          </select>
        </label>
        <p v-if="accountsLoading" class="muted small" role="status">正在读取系统用户与用户组…</p>
        <p v-if="accountsError" class="error" role="alert">{{ accountsError }}</p>
        <p v-if="operation.entry.symlink" class="muted small">符号链接只修改链接本身的属主；权限请进入目标后修改。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="file-dialog-actions">
          <button type="button" :disabled="busy" @click="closeDialog">取消</button>
          <button type="submit" class="file-primary" :disabled="busy || accountsLoading || !!accountsError">保存</button>
        </div>
      </form>
      <form v-else-if="operation.kind==='rename'" class="file-dialog-body" @submit.prevent="submitEntry">
        <h3 id="file-dialog-title">重命名</h3>
        <p class="file-dialog-target">{{ operation.entry.name }}</p>
        <label>新名称
          <input v-model="entryName" aria-label="新名称" required :disabled="busy" autofocus />
        </label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="file-dialog-actions">
          <button type="button" :disabled="busy" @click="closeDialog">取消</button>
          <button type="submit" class="file-primary" :disabled="busy">确定</button>
        </div>
      </form>
      <div v-else-if="operation.kind==='delete'" class="file-dialog-body">
        <h3 id="file-dialog-title">删除确认</h3>
        <p>确定删除 <strong>{{ operation.entry.name }}</strong>？</p>
        <p v-if="operation.entry.type==='directory' && !operation.entry.symlink">此文件夹中的所有内容也将删除。</p>
        <p class="muted small">删除后无法撤销。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="file-dialog-actions">
          <button type="button" :disabled="busy" @click="closeDialog">取消</button>
          <button type="button" class="file-danger" :disabled="busy" @click="confirmDelete">删除</button>
        </div>
      </div>
    </dialog>
    <p v-if="error && (!operation || operation.kind==='create')" class="error" role="alert">{{ error }}</p>
    <div v-if="message" class="file-toast" role="status">{{ message }}</div>
    <p v-if="busy" class="muted small" role="status">正在处理…</p>
    <div class="table-wrap">
      <table class="file-table">
        <thead><tr><th>名称</th><th>类型</th><th>大小（MB）</th><th>权限 / 所有者</th><th>修改时间</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="entry in listing.entries" :key="entry.name">
            <td><button type="button" class="file-entry" :disabled="busy || entry.type==='other'" @click="open(entry)">{{ entry.name }}{{ entry.type==='directory'?'/':'' }}</button></td>
            <td>{{ entry.type==='directory'?'目录':entry.type==='file'?'文件':'其他' }}{{ entry.symlink?' · 链接':'' }}</td>
            <td :title="entry.sizeComplete?'逻辑文件大小，1 MB = 1,000,000 B':'未完整统计；可能无权限、超过扫描限额或为目录链接'">{{ megabytes(entry) }}</td>
            <td><button type="button" class="file-permissions-button" :disabled="busy || entry.permissions==='—'"
              :aria-label="'修改权限和属主 '+entry.name" @click="editPermissions(entry)">
              <span class="file-permissions">{{ entry.permissions }}</span><span class="file-owner">{{ entry.owner }}</span>
            </button></td>
            <td><time v-if="dateParts(entry.modifiedAt)" :datetime="entry.modifiedAt" class="file-modified">
              <span class="file-date">{{ dateParts(entry.modifiedAt).date }}</span>
              <span class="file-time">{{ dateParts(entry.modifiedAt).time }}</span>
            </time><span v-else>—</span></td>
            <td><div class="file-row-actions">
              <button type="button" :disabled="busy || !canWrite" :aria-label="'重命名 '+entry.name" @click="beginRename(entry)">重命名</button>
              <button type="button" :disabled="busy || !canWrite" :aria-label="'删除 '+entry.name" @click="beginDelete(entry)">删除</button>
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
