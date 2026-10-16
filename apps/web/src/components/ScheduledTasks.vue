<script setup>
import {ref,computed,watch,onUnmounted} from 'vue';
const props=defineProps({
  initialData:{type:Object,required:true},listAction:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true},
  mode:{type:String,required:true,validator:value=>['managed','system'].includes(value)}
});
const emit=defineEmits(['unauthorized','listing-change']);
const listing=ref(props.initialData),busy=ref(false),error=ref(''),message=ref('');
const dialog=ref(null),deleteDialog=ref(null),draft=ref(null),removeTarget=ref(null);
const systemEditDialog=ref(null),systemConfirmDialog=ref(null),systemDraft=ref(null),systemConfirm=ref(null);
const systemSource=ref('all'),systemOwner=ref('all'),systemStatus=ref('all'),systemQuery=ref('');
const sources=[['all','全部'],['system-crontab','系统 Crontab'],['cron.d','Cron 配置'],['user-crontab','用户 Crontab'],['periodic','周期脚本'],['anacron','Anacron'],['at-job','AT 一次性任务'],['systemd-timer','systemd Timers']];
const systemOwners=computed(()=>[...new Set((listing.value.systemTasks??[]).map(x=>x.owner).filter(Boolean))]
  .sort((a,b)=>a.localeCompare(b,'zh-CN')));
const systemRows=computed(()=>(listing.value.systemTasks??[]).filter(x=>
  (systemSource.value==='all'||x.sourceType===systemSource.value)&&
  (systemOwner.value==='all'||x.owner===systemOwner.value)&&
  (systemStatus.value==='all'||x.enabled===(systemStatus.value==='enabled'))&&
  (!systemQuery.value||[x.source,x.name,x.owner,x.expression,x.command].some(v=>String(v??'').toLowerCase().includes(systemQuery.value.trim().toLowerCase())))
));
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
function openSystemEdit(record){
  if(record.control!=='cron'||!record.editable)return;
  error.value='';
  systemDraft.value={...record};
  systemEditDialog.value?.showModal();
}
function closeSystemEdit(){if(busy.value)return;systemEditDialog.value?.close();systemDraft.value=null;error.value='';}
function beginSystemAction(record,operation){
  if(record.control==='none')return;
  error.value='';systemConfirm.value={record,operation};
  systemConfirmDialog.value?.showModal();
}
function closeSystemConfirm(){if(busy.value)return;systemConfirmDialog.value?.close();systemConfirm.value=null;error.value='';}
function performSystemAction(){
  return task(async()=>{
    const {record,operation}=systemConfirm.value;
    await request(props.operations.systemSet,{id:record.id,revision:record.revision,operation});
    await refresh();
    systemConfirmDialog.value?.close();systemConfirm.value=null;notify('系统任务操作成功');
  });
}
function saveSystemEdit(){
  return task(async()=>{
    const record=systemDraft.value;
    await request(props.operations.systemSet,{
      id:record.id,revision:record.revision,operation:'edit',
      expression:record.expression,command:record.command
    });
    await refresh();
    systemEditDialog.value?.close();systemDraft.value=null;notify('已修改系统任务');
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
      <div class="panel-control-capsule">
        <button v-if="mode==='managed'" type="button" class="panel-control-primary" :disabled="busy" @click="openForm(null)">新建任务</button>
        <button type="button" :disabled="busy" @click="task(refresh)">刷新数据</button>
      </div>
      <span v-if="mode==='managed'" class="muted small">共 {{ listing.count }} 项</span>
      <span v-else class="muted small">系统 {{ listing.systemCount??0 }} 项</span>
    </div>
    <div v-if="message" class="task-notice" role="status">{{ message }}</div>
    <p v-if="error && !draft && !removeTarget" class="error" role="alert">{{ error }}</p>
    <p v-if="busy" class="muted small" role="status">正在处理…</p>
    <p v-if="mode==='managed'" class="muted small">新建任务写入独立的 /etc/cron.d/linux-panel，以 linuxpanel 用户运行。</p>
    <div v-if="mode==='managed'" class="table-wrap">
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
    <div v-if="mode==='system'" class="task-toolbar system-filters">
      <label>搜索
        <input v-model="systemQuery" placeholder="任务名称、用户或命令" aria-label="搜索系统任务" />
      </label>
      <span class="muted small">显示 {{ systemRows.length }} / {{ listing.systemCount??0 }} 项</span>
    </div>
    <p v-if="mode==='system' && listing.systemWarnings?.length" class="muted small" role="status">
      部分来源读取受限：{{ listing.systemWarnings.join('；') }}
    </p>
    <div v-if="mode==='system'" class="table-wrap">
      <table class="task-table system-task-table">
        <thead>
          <tr>
            <th>
              <label class="task-filter-heading">来源 / 任务
                <select v-model="systemSource" aria-label="按来源筛选">
                  <option v-for="[value,text] in sources" :key="value" :value="value">{{ text }}</option>
                </select>
              </label>
            </th>
            <th>
              <label class="task-filter-heading">执行用户
                <select v-model="systemOwner" aria-label="按执行用户筛选">
                  <option value="all">全部用户</option>
                  <option v-for="owner in systemOwners" :key="owner" :value="owner">{{ owner }}</option>
                </select>
              </label>
            </th>
            <th>计划 / 下次执行</th>
            <th>命令</th>
            <th>
              <label class="task-filter-heading">状态
                <select v-model="systemStatus" aria-label="按任务状态筛选">
                  <option value="all">全部状态</option>
                  <option value="enabled">已启用</option>
                  <option value="disabled">已停用</option>
                </select>
              </label>
            </th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in systemRows" :key="record.id">
            <td><strong>{{ record.name }}</strong><span class="system-origin">{{ record.sourceType }} · {{ record.source }}</span></td>
            <td>{{ record.owner }}</td>
            <td><code>{{ record.expression }}</code><span v-if="record.nextRun" class="system-origin">{{ record.nextRun }}</span></td>
            <td><code class="task-command">{{ record.command }}</code></td>
            <td>{{ record.enabled?'已启用':'已停用' }}</td>
            <td><div class="task-row-actions">
              <button v-if="record.control==='cron'&&record.editable" type="button" :disabled="busy" @click="openSystemEdit(record)">编辑</button>
              <button v-if="record.control==='cron'||record.control==='timer'" type="button" :disabled="busy" @click="beginSystemAction(record,record.enabled?'disable':'enable')">{{ record.enabled?'停用':'启用' }}</button>
              <button v-if="record.control==='cron'||record.control==='at'" type="button" :disabled="busy" @click="beginSystemAction(record,'remove')">删除</button>
              <span v-if="record.control==='none'" class="muted small" :title="record.detail">只读</span>
            </div></td>
          </tr>
          <tr v-if="!systemRows.length"><td colspan="6">该来源没有发现系统任务</td></tr>
        </tbody>
      </table>
    </div>
    <dialog v-if="mode==='system'" ref="systemEditDialog" class="task-dialog" aria-labelledby="system-edit-title" @close="systemDraft=null">
      <form v-if="systemDraft" class="task-form" @submit.prevent="saveSystemEdit">
        <h3 id="system-edit-title">编辑现有系统 Cron 任务</h3>
        <p class="muted small">{{ systemDraft.source }} · 执行用户 {{ systemDraft.owner }}。仅修改选中的任务行，不更改其他条目。</p>
        <label>Cron 表达式（分 时 日 月 星期）
          <input v-model="systemDraft.expression" required maxlength="100" :disabled="busy" />
        </label>
        <label>执行命令
          <textarea v-model="systemDraft.command" rows="5" required maxlength="2000" :disabled="busy" />
        </label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="task-dialog-actions">
          <button type="button" :disabled="busy" @click="closeSystemEdit">取消</button>
          <button type="submit" :disabled="busy">保存</button>
        </div>
      </form>
    </dialog>
    <dialog v-if="mode==='system'" ref="systemConfirmDialog" class="task-dialog" aria-labelledby="system-confirm-title" @close="systemConfirm=null">
      <div v-if="systemConfirm" class="task-form">
        <h3 id="system-confirm-title">确认修改系统任务</h3>
        <p>确定{{ {enable:'启用',disable:'停用',remove:'删除'}[systemConfirm.operation] }} <strong>{{ systemConfirm.record.name }}</strong>？</p>
        <p class="muted small">来源：{{ systemConfirm.record.source }}。执行用户：{{ systemConfirm.record.owner }}。这可能影响操作系统更新、维护或其他服务的调度。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="task-dialog-actions">
          <button type="button" :disabled="busy" @click="closeSystemConfirm">取消</button>
          <button type="button" :disabled="busy" @click="performSystemAction">确认操作</button>
        </div>
      </div>
    </dialog>
    <dialog v-if="mode==='managed'" ref="dialog" class="task-dialog" aria-labelledby="task-form-title" @close="draft=null">
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
    <dialog v-if="mode==='managed'" ref="deleteDialog" class="task-dialog" aria-labelledby="task-delete-title" @close="removeTarget=null">
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
.system-title{margin:1.15rem 0 .7rem}
.system-origin{display:block;margin-top:.25rem;font-size:.78rem;opacity:.7;overflow-wrap:anywhere}
.system-filters label{display:flex;align-items:center;gap:.4rem}
.system-filters input{min-height:2.35rem;max-width:18rem;font:inherit}
.task-filter-heading{display:flex;flex-direction:column;align-items:stretch;gap:.35rem;font-weight:inherit}
.task-filter-heading select{width:100%;min-width:7rem;max-width:15rem;min-height:2.35rem;font:inherit}
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
@media(max-width:730px){.task-table{min-width:650px}.system-task-table{min-width:950px}.task-toolbar{align-items:stretch}}
</style>
