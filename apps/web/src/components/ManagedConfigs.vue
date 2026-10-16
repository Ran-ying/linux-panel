<script setup>
import {ref,computed,watch,onUnmounted} from 'vue';
const props=defineProps({
  initialData:{type:Object,required:true},listAction:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true},
  labels:{type:Object,default:()=>({})}
});
const emit=defineEmits(['unauthorized','listing-change']);
const listing=ref(props.initialData),busy=ref(false),error=ref(''),notice=ref('');
const modal=ref(null),confirmModal=ref(null),draft=ref(null),pending=ref(null),checkResult=ref(null);
const selectedFile=ref(null);
const selectedSite=computed(()=>(listing.value.sites??[]).find(site=>site.file===selectedFile.value)??null);
const domains=site=>site.serverNames?.trim()
  ?site.serverNames.split(',').map(domain=>domain.trim()).filter(Boolean)
  :['—'];
function selectSite(site){
  if(busy.value)return;
  selectedFile.value=selectedFile.value===site.file?null:site.file;
}
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
  if(busy.value||!site.editable)return;
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
    if(current.revision!==site.revision)
      throw new Error('网站配置已被其他程序修改，请刷新后重新确认');
    await submit({name:site.name,operation,revision:site.revision},()=>{
      if(operation==='remove' && selectedFile.value===site.file)selectedFile.value=null;
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
    <Teleport to="#action-heading-actions-nginx-sites">
      <div class="config-toolbar">
        <button type="button" class="panel-control-primary" :disabled="busy" @click="openNew">{{ labels.create||'新建配置' }}</button>
        <button type="button" :disabled="busy" @click="work(refresh)">刷新数据</button>
        <button type="button" :disabled="busy" @click="check">{{ labels.check||'检查配置' }}</button>
      </div>
    </Teleport>
    <p class="config-summary muted small">{{ listing.count }} 项 · {{ listing.enabledCount }} 项启用或待确认</p>
    <p v-if="notice" role="status" class="config-notice">{{ notice }}</p>
    <p v-if="busy" role="status" class="muted small">正在处理…</p>
    <p v-if="error && !draft && !pending" role="alert" class="error">{{ error }}</p>
    <div v-if="checkResult" class="config-check" role="status">
      <strong>{{ checkResult.status }}</strong>
      <span class="muted small">（{{ checkResult.identity }} · 退出码 {{ checkResult.exitCode??'—' }}）</span>
      <pre v-if="checkResult.output">{{ checkResult.output }}</pre>
    </div>
    <div class="config-browser" :class="{'has-selection':!!selectedSite}">
      <section class="config-list-panel" aria-label="网站列表">
        <ul v-if="listing.sites.length" class="config-site-list">
          <li v-for="site in listing.sites" :key="site.file" class="config-site-row"
            :class="{'is-selected':selectedFile===site.file}">
            <input type="checkbox" class="config-status-checkbox"
              :checked="site.enabled==='启用链接'||site.enabled==='启用目录'"
              :indeterminate="site.enabled==='配置候选'"
              :disabled="busy||!site.editable"
              :aria-label="'启用状态：'+site.name"
              :title="site.editable
                ? '勾选启用，取消勾选停用；需要二次确认'
                : site.enabled==='配置候选'
                  ? '此配置的生效状态取决于 nginx.conf，不能在此启停'
                  : '此配置不能在此启停'"
              @click.prevent="ask(site,site.enabled==='启用链接'?'disable':'enable')" />
            <button type="button" class="config-site-selector" :disabled="busy"
              :aria-label="'查看网站 '+site.name" :aria-pressed="selectedFile===site.file"
              @click="selectSite(site)">
              <strong class="config-site-name">{{ site.name }}</strong>
              <span class="config-domains">
                <span v-for="(domain,index) in domains(site)" :key="index" class="config-domain">{{ domain }}</span>
              </span>
            </button>
          </li>
        </ul>
        <p v-else class="muted config-empty">没有找到站点配置文件</p>
      </section>
      <section v-if="selectedSite" class="config-detail-panel" :aria-label="'网站详情：'+selectedSite.name">
        <div class="config-detail-heading">
          <h3>{{ selectedSite.name }}</h3>
          <button type="button" :disabled="busy" @click="selectedFile=null">收起</button>
        </div>
        <div class="config-detail-section">
          <span class="muted small">域名</span>
          <span v-for="(domain,index) in domains(selectedSite)" :key="index"
            class="config-domain">{{ domain }}</span>
        </div>
        <div class="config-detail-section">
          <span class="muted small">状态</span>
          <span>{{ selectedSite.enabled==='启用链接'?'已启用'
            :selectedSite.enabled==='未启用'?'已停用':'状态待确认' }}</span>
        </div>
        <div v-if="selectedSite.editable" class="config-actions">
          <button type="button" :disabled="busy" :aria-label="'编辑 '+selectedSite.name"
            @click="openEdit(selectedSite)">编辑</button>
          <button type="button" :disabled="busy" :aria-label="'删除 '+selectedSite.name"
            @click="ask(selectedSite,'remove')">删除</button>
        </div>
        <p v-else class="muted small">此配置仅支持查看，不能直接编辑或删除。</p>
      </section>
    </div>
    <details v-if="listing.warnings?.length" class="config-warnings">
      <summary>读取提示（{{ listing.warnings.length }}）</summary>
      <p v-for="(warning,i) in listing.warnings" :key="i" class="muted small">{{ warning }}</p>
    </details>

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
.managed-configs{border:0;border-radius:0;background:transparent;box-shadow:none;padding:0;margin:0}
.config-toolbar,.config-actions,.config-dialog-actions{display:flex;gap:.55rem;align-items:center;flex-wrap:wrap}
.config-toolbar{margin:0;justify-content:flex-end}
.config-actions button,.config-dialog-actions button{font:inherit;min-height:2.35rem;padding:.35rem .8rem}
.config-summary{margin:.1rem 0 .45rem}
.config-browser{display:grid;grid-template-columns:minmax(0,17rem);align-items:start;gap:1rem;min-width:0}
.config-browser.has-selection{grid-template-columns:minmax(0,17rem) minmax(0,1fr)}
.config-list-panel{border:1px solid var(--border-panel);border-radius:12px;min-width:0;
  overflow:hidden;background:var(--panel-bg);box-shadow:none;padding:0}
.config-detail-panel{border:0;border-left:1px solid var(--border-panel);border-radius:0;
  min-width:0;overflow:visible;background:transparent;box-shadow:none;padding-left:1rem}
.config-site-list{list-style:none;margin:0;padding:0}
.config-site-row{display:flex;align-items:center;gap:.55rem;border-bottom:1px solid var(--border,#8885)}
.config-site-row:last-child{border-bottom:none}
.config-site-row.is-selected{background:var(--surface-secondary,#8881)}
.config-site-selector{flex:1;display:flex;flex-direction:column;gap:.25rem;min-width:0;
  border:0;background:none;color:inherit;text-align:left;padding:.7rem .3rem .7rem 0;
  font:inherit;cursor:pointer}
.config-site-selector:focus-visible{outline:2px solid var(--accent,#538ad7);outline-offset:-2px}
.config-site-selector:disabled{cursor:wait}
.config-site-name{font-weight:600;overflow-wrap:anywhere}
.config-domains,.config-detail-section{display:flex;flex-direction:column;gap:.2rem;min-width:0}
.config-domain{display:block;font-size:.87rem;color:var(--text-muted,#888);overflow-wrap:anywhere}
.config-status-checkbox{width:1.15rem;height:1.15rem;min-width:1.15rem;margin:0 0 0 .2rem;
  cursor:pointer;accent-color:var(--accent,#538ad7)}
.config-status-checkbox:disabled{cursor:not-allowed;opacity:.65}
.config-empty{padding:1rem;margin:0}
.config-detail-panel{padding-top:.1rem;padding-right:0;padding-bottom:0;display:grid;gap:1.1rem}
.config-detail-heading{display:flex;justify-content:space-between;align-items:center;gap:.7rem}
.config-detail-heading h3{margin:0;font-size:1.1rem;overflow-wrap:anywhere}
.config-detail-heading button{font:inherit;min-height:2.2rem;padding:.25rem .7rem}
.config-detail-section{gap:.35rem}
.config-detail-section .config-domain{font-size:1rem}
.config-actions{gap:.5rem}
.config-actions button{white-space:nowrap}
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
@media(max-width:900px){
  .config-browser.has-selection{grid-template-columns:minmax(0,1fr)}
  .config-browser{grid-template-columns:minmax(0,1fr)}
  .config-detail-panel{border-left:0;border-top:1px solid var(--border-panel);padding:1rem 0 0}
}
</style>
