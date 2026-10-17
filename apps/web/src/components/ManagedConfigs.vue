<script setup>
import {ref,computed,watch,onUnmounted} from 'vue';
import NginxCertificates from './NginxCertificates.vue';
import {updateNginxSiteDomain,validNginxDomain} from '../nginx-site-domains.js';
const props=defineProps({
  initialData:{type:Object,required:true},listAction:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true},
  labels:{type:Object,default:()=>({})}
});
const emit=defineEmits(['unauthorized','listing-change']);
const listing=ref(props.initialData),busy=ref(false),error=ref(''),notice=ref('');
const modal=ref(null),confirmModal=ref(null),draft=ref(null),pending=ref(null),checkResult=ref(null);
const selectedFile=ref(null);
const addingDomain=ref(false),domainInput=ref(''),domainError=ref('');
const domainConfirm=ref(null),pendingDomain=ref(null);
const selectedSite=computed(()=>(listing.value.sites??[]).find(site=>site.file===selectedFile.value)??null);
// This is a read-only preview of the selected site's real Nginx file. It does
// not enter the edit draft or mutate the on-disk configuration.
const configPreview=ref(null),configPreviewLoading=ref(false),configPreviewError=ref('');
const inlineDraft=ref(null),inlineError=ref('');
let configPreviewGeneration=0;
const domains=site=>site.serverNames?.trim()
  ?site.serverNames.split(',').map(domain=>domain.trim()).filter(Boolean)
  :['—'];
function selectSite(site){
  if(busy.value)return;
  if(inlineDraft.value||addingDomain.value||pendingDomain.value){
    domainError.value='请先保存或取消当前配置或域名操作，再切换网站';
    return;
  }
  selectedFile.value=selectedFile.value===site.file?null:site.file;
}
let noticeTimer;
watch(()=>props.initialData,v=>{listing.value=v;});
watch(selectedFile,()=>{addingDomain.value=false;domainInput.value='';domainError.value='';});
function startAddingDomain(){
  if(busy.value||inlineDraft.value||pendingDomain.value)return;
  domainError.value='';domainInput.value='';addingDomain.value=true;
}
function cancelAddingDomain(){
  if(busy.value)return;
  addingDomain.value=false;domainInput.value='';domainError.value='';
}
function requestRemoveDomain(domain){
  if(busy.value||inlineDraft.value||addingDomain.value)return;
  domainError.value='';
  pendingDomain.value={site:selectedSite.value,domain};
  domainConfirm.value?.showModal();
}
function cancelRemoveDomain(){
  if(busy.value)return;
  domainConfirm.value?.close();
  pendingDomain.value=null;domainError.value='';
}
async function applyDomainChange(operation,domain,site){
  return work(async()=>{
    domainError.value='';
    try{
      if(!site?.editable||selectedSite.value?.file!==site.file)
        throw Error('该网站不可编辑或已切换');
      if(inlineDraft.value)throw Error('请先完成 Nginx 配置编辑');
      if(!validNginxDomain(domain))
        throw Error('请输入合法域名，例如 example.com');
      const current=await request(props.operations.read,{name:site.name});
      if(current.revision!==site.revision)
        throw Error('网站配置已变化，请刷新网站数据后重试');
      const content=updateNginxSiteDomain(current.content,operation,domain);
      const outcome=await request(props.operations.apply,{
        name:site.name,content,revision:current.revision,operation:'edit'
      });
      if(!outcome.ok)throw Error(outcome.status+(outcome.output?': '+outcome.output:''));
      configPreview.value=content;
      if(operation==='add'){addingDomain.value=false;domainInput.value='';}
      else{domainConfirm.value?.close();pendingDomain.value=null;}
      notify(outcome.status);
      await refresh();
    }catch(cause){
      domainError.value=cause.message||'域名操作失败，修改未保存';
    }
  });
}

watch(()=>selectedSite.value?selectedSite.value.name+'|'+selectedSite.value.revision:null,async()=>{
  const site=selectedSite.value,generation=++configPreviewGeneration;
  configPreview.value=null;configPreviewError.value='';configPreviewLoading.value=!!site;
  if(!site)return;
  try{
    const file=await request(props.operations.read,{name:site.name});
    if(generation!==configPreviewGeneration)return;
    configPreview.value=file.content;
  }catch(cause){
    if(generation===configPreviewGeneration)
      configPreviewError.value=cause.message||'无法读取 Nginx 配置';
  }finally{
    if(generation===configPreviewGeneration)configPreviewLoading.value=false;
  }
},{immediate:true});
onUnmounted(()=>{configPreviewGeneration++;clearTimeout(noticeTimer);});

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
function openInlineEdit(site){
  if(inlineDraft.value||busy.value||addingDomain.value||pendingDomain.value)return;
  return work(async()=>{
    inlineError.value='';
    const data=await request(props.operations.read,{name:site.name});
    if(selectedSite.value?.file!==site.file)return;
    inlineDraft.value={name:data.name,content:data.content,revision:data.revision};
  });
}
function cancelInlineEdit(){
  if(busy.value)return;
  inlineDraft.value=null;
  inlineError.value='';
}
function saveInlineEdit(){
  return work(async()=>{
    const editing=inlineDraft.value;
    if(!editing||selectedSite.value?.name!==editing.name)return;
    inlineError.value='';
    let outcome;
    try{
      outcome=await request(props.operations.apply,{
        name:editing.name,content:editing.content,revision:editing.revision,operation:'edit'
      });
    }catch(cause){
      inlineError.value=cause.message||'保存配置失败，请核对后重试';
      return;
    }
    if(!outcome.ok){
      inlineError.value=outcome.status+(outcome.output?': '+outcome.output:'');
      return;
    }
    // Only the server's successful validated apply commits this local draft.
    // Keep the exact content visible while the refreshed listing triggers a read.
    configPreview.value=editing.content;
    inlineDraft.value=null;
    notify(outcome.status);
    try{await refresh();}
    catch(cause){error.value='配置已保存，但刷新网站列表失败：'+cause.message;}
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
        <section class="config-detail-card config-site-info-card" aria-label="网站基本信息">
          <div class="config-detail-heading">
            <h3>{{ selectedSite.name }}</h3>
            <button v-if="selectedSite.editable" type="button"
              :disabled="busy||!!inlineDraft||addingDomain||!!pendingDomain"
              :aria-label="'删除 '+selectedSite.name"
              @click="ask(selectedSite,'remove')">删除</button>
          </div>
          <div class="config-site-facts">
            <span class="muted small">域名</span>
            <div class="config-site-domains">
              <div v-for="(domain,index) in domains(selectedSite)" :key="index"
                class="config-site-domain-row">
                <span class="config-domain">{{ domain }}</span>
                <button v-if="selectedSite.editable && domain!=='—'" type="button"
                  :disabled="busy||!!inlineDraft||addingDomain||!!pendingDomain"
                  :aria-label="'删除域名 '+domain" @click="requestRemoveDomain(domain)">移除</button>
              </div>
              <button v-if="selectedSite.editable && !addingDomain" type="button"
                class="config-domain-add" :disabled="busy||!!inlineDraft||!!pendingDomain"
                @click="startAddingDomain">添加域名</button>
              <form v-if="addingDomain" class="config-domain-add-form"
                @submit.prevent="applyDomainChange('add',domainInput,selectedSite)">
                <input v-model="domainInput" type="text" aria-label="新域名"
                  placeholder="example.com" spellcheck="false" autocomplete="off"
                  :disabled="busy" required maxlength="253" />
                <div class="config-domain-add-actions">
                  <button type="button" :disabled="busy" @click="cancelAddingDomain">取消</button>
                  <button type="submit" :disabled="busy">保存域名</button>
                </div>
              </form>
            </div>
            <span class="muted small">状态</span>
            <span class="config-site-state">{{ selectedSite.enabled==='启用链接'?'已启用'
              :selectedSite.enabled==='启用目录'?'已启用'
              :selectedSite.enabled==='未启用'?'已停用':'状态待确认' }}</span>
          </div>
          <p v-if="domainError" class="error" role="alert">{{ domainError }}</p>
          <p v-if="!selectedSite.editable" class="muted small">此配置仅支持查看，不能编辑或删除。</p>
        </section>
        <section class="config-detail-card config-nginx-card" aria-label="Nginx 配置">
          <div class="config-nginx-heading">
            <h4>Nginx 配置</h4>
            <button v-if="selectedSite.editable && !inlineDraft" type="button"
              :disabled="busy" :aria-label="'编辑 '+selectedSite.name"
              @click="openInlineEdit(selectedSite)">编辑</button>
          </div>
          <form v-if="inlineDraft" class="config-inline-form" @submit.prevent="saveInlineEdit">
            <textarea v-model="inlineDraft.content" aria-label="Nginx 配置内容"
              required maxlength="65536" spellcheck="false" :disabled="busy" rows="16" />
            <p class="muted small">保存时会验证 Nginx 配置，版本冲突或校验失败不会覆盖现有配置。</p>
            <p v-if="inlineError" class="error" role="alert">{{ inlineError }}</p>
            <div class="config-inline-actions">
              <button type="button" :disabled="busy" @click="cancelInlineEdit">取消</button>
              <button type="submit" :disabled="busy">保存配置</button>
            </div>
          </form>
          <template v-else>
            <p v-if="configPreviewLoading" class="muted small" role="status">正在读取配置…</p>
            <p v-else-if="configPreviewError" class="error" role="alert">{{ configPreviewError }}</p>
            <pre v-else-if="configPreview!==null" class="config-nginx-preview"><code>{{ configPreview }}</code></pre>
            <p v-else class="muted small">尚未读取到配置内容</p>
          </template>
        </section>
        <section v-if="operations.certificates && operations.renew"
          class="config-detail-card config-ssl-section" aria-label="网站 SSL 证书管理">
          <NginxCertificates :key="selectedSite.file"
            :site-name="selectedSite.name" :site-domains="domains(selectedSite)"
            :operations="operations" :csrf="csrf" @unauthorized="emit('unauthorized')" />
        </section>
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

    <dialog ref="domainConfirm" class="config-dialog" aria-labelledby="config-domain-confirm-heading"
      @close="pendingDomain=null">
      <div v-if="pendingDomain" class="config-form">
        <h3 id="config-domain-confirm-heading">确认移除域名</h3>
        <p>从 <strong>{{ pendingDomain.site.name }}</strong> 的 Nginx server_name 中移除
          <strong>{{ pendingDomain.domain }}</strong>？</p>
        <p class="muted small">将按现有站点配置版本校验并执行 nginx -t；不能删除最后一个域名。SSL 证书本身不会被删除。</p>
        <p v-if="domainError" class="error" role="alert">{{ domainError }}</p>
        <div class="config-dialog-actions">
          <button type="button" :disabled="busy" @click="cancelRemoveDomain">取消</button>
          <button type="button" :disabled="busy"
            @click="applyDomainChange('remove',pendingDomain.domain,pendingDomain.site)">确认移除</button>
        </div>
      </div>
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
.config-detail-panel{border:0;border-radius:0;min-width:0;overflow:visible;
  background:transparent;box-shadow:none;padding:0}
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
.config-status-checkbox{width:1.15rem;height:1.15rem;min-width:1.15rem;margin:0 0 0 .75rem;
  cursor:pointer;accent-color:var(--accent,#538ad7)}
.config-status-checkbox:disabled{cursor:not-allowed;opacity:.65}
.config-empty{padding:1rem;margin:0}
.config-detail-panel{display:grid;gap:12px;align-content:start}
.config-detail-card{display:grid;gap:12px;min-width:0;padding:14px;
  border:1px solid var(--border-panel);border-radius:12px;background:var(--panel-bg)}
.config-nginx-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.config-nginx-card h4{margin:0;font-size:1rem;font-weight:600}
.config-inline-form{display:grid;gap:10px;min-width:0}
.config-inline-form textarea{box-sizing:border-box;width:100%;min-width:0;min-height:18rem;
  max-height:70vh;resize:vertical;overflow:auto;padding:12px;
  background:var(--input-bg);color:var(--text-primary);
  border:1px solid var(--input-border);border-radius:8px;
  font:inherit;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
  font-size:.82rem;line-height:1.55;tab-size:2}
.config-inline-form p{margin:0}
.config-inline-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.config-nginx-preview{margin:0;min-width:0;max-height:22rem;overflow:auto;
  padding:12px;border:1px solid var(--border-rule);border-radius:8px;
  background:var(--input-bg);color:var(--text-primary);font:inherit;
  font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
  font-size:.82rem;line-height:1.55;white-space:pre;tab-size:2}
.config-detail-heading{display:flex;justify-content:space-between;align-items:center;gap:.7rem}
.config-detail-heading h3{margin:0;font-size:1.1rem;overflow-wrap:anywhere}
.config-detail-heading button{font:inherit;min-height:2.2rem;padding:.25rem .7rem}
.config-site-facts{display:grid;grid-template-columns:minmax(4rem,auto) minmax(0,1fr);
  gap:12px 16px;align-items:start;min-width:0}
.config-site-domains{display:grid;justify-items:start;gap:8px;min-width:0}
.config-site-domain-row{display:flex;align-items:center;gap:8px;min-width:0;
  flex-wrap:wrap}
.config-site-domain-row .config-domain{font-size:1rem}
.config-site-state{overflow-wrap:anywhere}
.config-domain-add{justify-self:start}
.config-domain-add-form{display:grid;gap:8px;min-width:0;max-width:100%}
.config-domain-add-form input{box-sizing:border-box;min-width:0;width:min(100%,22rem);
  padding:8px;border:1px solid var(--input-border);border-radius:8px;
  background:var(--input-bg);color:var(--text-primary);font:inherit}
.config-domain-add-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
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
  .config-detail-panel{border:0;padding:0}
}
</style>
