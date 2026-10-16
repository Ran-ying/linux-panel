<script setup>
import {ref,watch,onUnmounted} from 'vue';
const props=defineProps({
  initialData:{type:Object,required:true},listAction:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true},
  labels:{type:Object,default:()=>({})}
});
const emit=defineEmits(['unauthorized','listing-change']);
const listing=ref(props.initialData),busy=ref(false),error=ref(''),notice=ref('');
const modal=ref(null),confirmModal=ref(null),draft=ref(null),pending=ref(null),checkResult=ref(null);
let noticeTimer;
watch(()=>props.initialData,v=>{listing.value=v;});
onUnmounted(()=>clearTimeout(noticeTimer));

async function request(action,input={}){
  const response=await fetch('/api/actions/'+encodeURIComponent(action)+'/execute',{
    method:'POST',headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
    body:JSON.stringify({input})
  });
  const body=await response.json();
  if(response.status===401)emit('unauthorized');
  if(!response.ok)throw new Error(body.error||'HTTP '+response.status);
  return body.result;
}
async function refresh(){
  const data=await request(props.listAction);
  listing.value=data;emit('listing-change',data);
}
function notify(value){
  notice.value=value;clearTimeout(noticeTimer);
  noticeTimer=setTimeout(()=>{notice.value='';},3500);
}
async function work(fn){
  if(busy.value)return;
  busy.value=true;error.value='';
  try{await fn();}
  catch(cause){error.value=cause.message||'操作失败';}
  finally{busy.value=false;}
}
function openNew(){
  error.value='';
  draft.value={name:'',content:'server {\n    listen 80;\n    server_name example.com;\n    root /var/www/html;\n}\n',revision:'',operation:'create'};
  modal.value?.showModal();
}
function openEdit(site){
  return work(async()=>{
    const data=await request(props.operations.read,{name:site.name});
    draft.value={name:data.name,content:data.content,revision:data.revision,operation:'edit'};
    modal.value?.showModal();
  });
}
function closeEditor(){if(busy.value)return;modal.value?.close();draft.value=null;error.value='';}
function closeConfirm(){if(busy.value)return;confirmModal.value?.close();pending.value=null;error.value='';}
function ask(site,operation){
  error.value='';pending.value={site,operation};
  confirmModal.value?.showModal();
}
async function submit(input,onSuccess){
  const response=await request(props.operations.apply,input);
  await refresh();
  if(!response.ok){
    error.value=response.status+(response.output?': '+response.output:'');
    return;
  }
  onSuccess();
  notify(response.status);
}
function save(){
  return work(async()=>{
    await submit({name:draft.value.name,content:draft.value.content,revision:draft.value.revision,
      operation:draft.value.operation},()=>{
      modal.value?.close();draft.value=null;
    });
  });
}
function confirm(){
  return work(async()=>{
    const {site,operation}=pending.value;
    const current=await request(props.operations.read,{name:site.name});
    await submit({name:site.name,operation,revision:current.revision},()=>{
      confirmModal.value?.close();pending.value=null;
    });
  });
}
function check(){
  return work(async()=>{
    checkResult.value=await request(props.operations.check);
  });
}
</script>

<template>
  <section class="managed-configs">
    <div class="config-toolbar">
      <button type="button" :disabled="busy" @click="openNew">{{ labels.create||'新建配置' }}</button>
      <button type="button" :disabled="busy" @click="work(refresh)">刷新数据</button>
      <button type="button" :disabled="busy" @click="check">{{ labels.check||'检查配置' }}</button>
      <span class="muted small">{{ listing.count }} 项 · {{ listing.enabledCount }} 项启用或待确认</span>
    </div>
    <p v-if="notice" role="status" class="config-notice">{{ notice }}</p>
    <p v-if="busy" role="status" class="muted small">正在处理…</p>
    <p v-if="error && !draft && !pending" role="alert" class="error">{{ error }}</p>
    <div v-if="checkResult" class="config-check" role="status">
      <strong>{{ checkResult.status }}</strong>
      <span class="muted small">（{{ checkResult.identity }} · 退出码 {{ checkResult.exitCode??'—' }}）</span>
      <pre v-if="checkResult.output">{{ checkResult.output }}</pre>
    </div>
    <div class="table-wrap">
      <table class="config-table">
        <thead><tr><th>配置名</th><th>状态</th><th>域名</th><th>监听</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="site in listing.sites" :key="site.file">
            <td><strong>{{ site.name }}</strong><small class="muted config-location">{{ site.location }}</small></td>
            <td>{{ site.enabled }}</td>
            <td>{{ site.serverNames||'—' }}</td>
            <td>{{ site.listens||'—' }}</td>
            <td>
              <div v-if="site.editable" class="config-actions">
                <button type="button" :disabled="busy" :aria-label="'编辑 '+site.name" @click="openEdit(site)">编辑</button>
                <button type="button" :disabled="busy" :aria-label="(site.enabled==='启用链接'?'停用 ':'启用 ')+site.name"
                  @click="ask(site,site.enabled==='启用链接'?'disable':'enable')">
                  {{ site.enabled==='启用链接'?'停用':'启用' }}
                </button>
                <button type="button" :disabled="busy" :aria-label="'删除 '+site.name" @click="ask(site,'remove')">删除</button>
              </div>
              <span v-else class="muted small">只读</span>
            </td>
          </tr>
          <tr v-if="!listing.sites.length"><td colspan="5">没有找到站点配置文件</td></tr>
        </tbody>
      </table>
    </div>
    <details v-if="listing.warnings?.length" class="config-warnings">
      <summary>读取提示（{{ listing.warnings.length }}）</summary>
      <p v-for="(warning,i) in listing.warnings" :key="i" class="muted small">{{ warning }}</p>
    </details>
    <p class="muted small">仅 sites-available 常规文件支持管理。启用/停用通过 sites-enabled 链接进行；conf.d 为只读候选，实际生效由 nginx.conf 决定。写入后进行语法检查，已启用的站点变更会尝试重载，失败则恢复文件。</p>

    <dialog ref="modal" class="config-dialog" aria-labelledby="config-form-heading" @close="draft=null">
      <form v-if="draft" class="config-form" @submit.prevent="save">
        <h3 id="config-form-heading">{{ draft.operation==='create'?'新建网站配置':'编辑网站配置' }}</h3>
        <label>配置文件名
          <input v-model="draft.name" aria-label="配置文件名" required maxlength="100"
            pattern="[A-Za-z0-9][A-Za-z0-9._-]*" :readonly="draft.operation!=='create'"
            :disabled="busy" spellcheck="false" />
        </label>
        <label>Nginx 配置内容
          <textarea v-model="draft.content" aria-label="Nginx 配置内容" required rows="13"
            maxlength="65536" spellcheck="false" :disabled="busy" />
        </label>
        <p class="muted small">新建文件默认不启用。编辑启用中的站点会先执行 nginx -t，再尝试重载，失败时恢复原配置。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="config-dialog-actions">
          <button type="button" :disabled="busy" @click="closeEditor">取消</button>
          <button type="submit" :disabled="busy">保存配置</button>
        </div>
      </form>
    </dialog>

    <dialog ref="confirmModal" class="config-dialog" aria-labelledby="config-confirm-heading" @close="pending=null">
      <div v-if="pending" class="config-form">
        <h3 id="config-confirm-heading">{{ pending.operation==='remove'?'删除网站配置':pending.operation==='enable'?'启用网站':'停用网站' }}</h3>
        <p>确定对 <strong>{{ pending.site.name }}</strong> 执行此操作？</p>
        <p class="muted small">启停或删除启用站点将尝试重载 Nginx。检查或重载失败时恢复配置。删除配置无法通过面板撤销。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="config-dialog-actions">
          <button type="button" :disabled="busy" @click="closeConfirm">取消</button>
          <button type="button" :disabled="busy" @click="confirm">确认操作</button>
        </div>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.config-toolbar,.config-actions,.config-dialog-actions{display:flex;gap:.55rem;align-items:center;flex-wrap:wrap}
.config-toolbar{margin:.2rem 0 1rem}
.config-toolbar button,.config-actions button,.config-dialog-actions button{font:inherit;min-height:2.35rem;padding:.35rem .8rem}
.config-table{width:100%;text-align:left}
.config-table th,.config-table td{vertical-align:top}
.config-actions{gap:.3rem}
.config-actions button{white-space:nowrap}
.config-location{display:block;overflow-wrap:anywhere}
.config-check{padding:.7rem 0}
.config-check pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto}
.config-warnings{margin:.8rem 0}
.config-dialog{background:var(--surface,Canvas);color:inherit;border:1px solid var(--border,#8885);
 border-radius:12px;padding:1.2rem;width:min(94vw,52rem);max-height:90vh}
.config-dialog::backdrop{background:#0008}
.config-form{display:grid;gap:1rem}
.config-form h3{margin:0}
.config-form label{display:grid;gap:.4rem;font-weight:600}
.config-form label input,.config-form textarea{width:100%;min-width:0;box-sizing:border-box;font:inherit}
.config-form textarea{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.config-dialog-actions{justify-content:flex-end}
.config-notice{padding:.55rem 0}
@media(max-width:730px){.config-table{min-width:760px}.config-toolbar{align-items:stretch}}
</style>
