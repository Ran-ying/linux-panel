<script setup>
import {ref,watch,onUnmounted} from 'vue';
const props=defineProps({
  initialData:{type:Object,required:true},listAction:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true}
});
const emit=defineEmits(['unauthorized','listing-change']);
const listing=ref(props.initialData),busy=ref(false),error=ref(''),message=ref('');
const dialog=ref(null),deleteDialog=ref(null),draft=ref(null),removeTarget=ref(null);
let noticeTimer;
watch(()=>props.initialData,value=>{listing.value=value;});
onUnmounted(()=>clearTimeout(noticeTimer));
async function request(action,input){
  const response=await fetch('/api/actions/'+encodeURIComponent(action)+'/execute',{
    method:'POST',headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
    body:JSON.stringify({input})
  });
  const body=await response.json();
  if(response.status===401)emit('unauthorized');
  if(!response.ok)throw new Error(body.error || 'HTTP '+response.status);
  return body.result;
}
async function refresh(){
  const data=await request(props.listAction,{});
  listing.value=data;emit('listing-change',data);
}
function notify(text){
  message.value=text;clearTimeout(noticeTimer);
  noticeTimer=setTimeout(()=>{message.value='';},3500);
}
async function task(work){
  if(busy.value)return;
  busy.value=true;error.value='';
  try{await work();}
  catch(cause){error.value=cause.message;}
  finally{busy.value=false;}
}
function openForm(record){
  error.value='';
  draft.value=record?{...record}:{name:'',expression:'0 * * * *',command:'',enabled:true};
  dialog.value?.showModal();
}
function closeForm(){if(busy.value)return;dialog.value?.close();draft.value=null;error.value='';}
function closeDelete(){if(busy.value)return;deleteDialog.value?.close();removeTarget.value=null;error.value='';}
function promptDelete(record){error.value='';removeTarget.value=record;deleteDialog.value?.showModal();}
function save(){
  return task(async()=>{
    const result=await request(props.operations.save,{revision:listing.value.revision,task:draft.value});
    await refresh();
    dialog.value?.close();draft.value=null;
    notify('已保存任务 '+result.id);
  });
}
function toggle(record){
  return task(async()=>{
    await request(props.operations.save,{revision:listing.value.revision,task:{...record,enabled:!record.enabled}});
    await refresh();notify(record.enabled?'已停用':'已启用');
  });
}
function remove(){
  return task(async()=>{
    await request(props.operations.remove,{revision:listing.value.revision,id:removeTarget.value.id});
    await refresh();deleteDialog.value?.close();removeTarget.value=null;notify('已删除');
  });
}
</script>

<template>
  <section class="scheduled-tasks">
    <div class="task-toolbar">
      <button type="button" :disabled="busy" @click="openForm(null)">新建任务</button>
      <button type="button" :disabled="busy" @click="task(refresh)">刷新数据</button>
      <span class="muted small">共 {{ listing.count }} 项 · 执行用户 linuxpanel</span>
    </div>
    <div v-if="message" class="task-notice" role="status">{{ message }}</div>
    <p v-if="error && !draft && !removeTarget" class="error" role="alert">{{ error }}</p>
    <p v-if="busy" class="muted small" role="status">正在处理…</p>
    <div class="table-wrap">
      <table class="task-table">
        <thead><tr><th>名称</th><th>计划（服务器本地时间）</th><th>命令</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="record in listing.tasks" :key="record.id">
            <td>{{ record.name }}</td>
            <td><code>{{ record.expression }}</code></td>
            <td><code class="task-command">{{ record.command }}</code></td>
            <td>{{ record.enabled?'已启用':'已停用' }}</td>
            <td><div class="task-row-actions">
              <button type="button" :disabled="busy" :aria-label="'编辑 '+record.name" @click="openForm(record)">编辑</button>
              <button type="button" :disabled="busy" :aria-label="(record.enabled?'停用 ':'启用 ')+record.name" @click="toggle(record)">{{ record.enabled?'停用':'启用' }}</button>
              <button type="button" :disabled="busy" :aria-label="'删除 '+record.name" @click="promptDelete(record)">删除</button>
            </div></td>
          </tr>
          <tr v-if="!listing.tasks.length"><td colspan="5">暂无由 Linux Panel 管理的定时任务</td></tr>
        </tbody>
      </table>
    </div>
    <dialog ref="dialog" class="task-dialog" aria-labelledby="task-form-title" @close="draft=null">
      <form v-if="draft" class="task-form" @submit.prevent="save">
        <h3 id="task-form-title">{{ draft.id?'编辑定时任务':'新建定时任务' }}</h3>
        <label>任务名称
          <input v-model="draft.name" aria-label="任务名称" required maxlength="80" :disabled="busy" />
        </label>
        <label>Cron 表达式（分 时 日 月 星期）
          <input v-model="draft.expression" aria-label="Cron 表达式" required maxlength="100"
            placeholder="例如 */5 * * * *" spellcheck="false" :disabled="busy" />
        </label>
        <label>执行命令
          <textarea v-model="draft.command" aria-label="执行命令" required maxlength="500" rows="4"
            spellcheck="false" :disabled="busy" />
        </label>
        <label class="task-switch"><input v-model="draft.enabled" type="checkbox" :disabled="busy" /> 启用</label>
        <p class="muted small">任务以 linuxpanel 用户在服务器本地时区执行。Cron 使用 /bin/sh；百分号需按 Cron 规则转义。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="task-dialog-actions">
          <button type="button" :disabled="busy" @click="closeForm">取消</button>
          <button type="submit" :disabled="busy">保存</button>
        </div>
      </form>
    </dialog>
    <dialog ref="deleteDialog" class="task-dialog" aria-labelledby="task-delete-title" @close="removeTarget=null">
      <div v-if="removeTarget" class="task-form">
        <h3 id="task-delete-title">删除任务</h3>
        <p>确定删除 <strong>{{ removeTarget.name }}</strong>？删除后不再安排后续执行，已经运行的进程不会终止。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="task-dialog-actions">
          <button type="button" :disabled="busy" @click="closeDelete">取消</button>
          <button type="button" :disabled="busy" @click="remove">删除</button>
        </div>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.task-toolbar,.task-row-actions,.task-dialog-actions{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.task-toolbar{margin:.2rem 0 1rem}
.task-toolbar button,.task-row-actions button,.task-dialog-actions button{min-height:2.35rem;font:inherit;padding:.35rem .8rem}
.task-table{width:100%;text-align:left}
.task-table th,.task-table td{vertical-align:top}
.task-command{white-space:pre-wrap;overflow-wrap:anywhere;max-width:28rem;display:block}
.task-row-actions{gap:.3rem}
.task-row-actions button{white-space:nowrap}
.task-dialog{border:1px solid var(--border, #8885);border-radius:12px;color:inherit;background:var(--surface,Canvas);padding:1.2rem;width:min(94vw,35rem);max-height:90vh}
.task-dialog::backdrop{background:#0008}
.task-form{display:grid;gap:1rem}
.task-form h3{margin:0}
.task-form label{display:grid;gap:.4rem;font-weight:600}
.task-form label input,.task-form textarea{width:100%;min-width:0;box-sizing:border-box;font:inherit}
.task-form .task-switch{display:flex;align-items:center;font-weight:400}
.task-switch input{width:auto!important}
.task-dialog-actions{justify-content:flex-end}
.task-notice{padding:.6rem 0}
@media(max-width:730px){.task-table{min-width:650px}.task-toolbar{align-items:stretch}}
</style>
