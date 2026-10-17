<script setup>
import {computed,nextTick,onMounted,ref,watch} from 'vue';
const props=defineProps({
  initialData:{type:Object,required:true},listAction:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true}
});
const emit=defineEmits(['unauthorized','listing-change']);
const data=ref(props.initialData),busy=ref(false),error=ref(''),notice=ref(''),output=ref('');
const draft=ref(''),revision=ref(''),original=ref(''),loaded=ref(false);
const section=ref('full'),sectionText=ref(''),sectionOriginal=ref('');
const confirm=ref(null),confirmDialog=ref(null);
const sections=['inbounds','outbounds','routing','dns','transport','log','policy','api','stats','reverse','observatory','burstObservatory','metrics','inboundDetour','outboundDetour'];
const names={inbounds:'入站连接',outbounds:'出站连接',routing:'路由规则',dns:'DNS',transport:'传输设置',
  log:'日志',policy:'流量策略',api:'API',stats:'统计',reverse:'反向代理',observatory:'观测',
  burstObservatory:'突发观测',metrics:'指标',inboundDetour:'旧版入站扩展',outboundDetour:'旧版出站扩展'};
const parse=()=>{const obj=JSON.parse(draft.value);if(!obj||Array.isArray(obj)||typeof obj!=='object')throw Error('配置必须是 JSON 对象');return obj;};
const dirty=computed(()=>draft.value!==original.value||
  (section.value!=='full'&&sectionText.value!==sectionOriginal.value));
const editorEntries=[{key:'full',label:'完整内容'},...sections.map(key=>({key,label:names[key]}))];
const editorLabel=computed(()=>section.value==='full'?'完整 V2Ray JSON 配置':names[section.value]+' · JSON');
watch(()=>props.initialData,v=>{data.value=v;});
async function call(action,input={}){
  const reply=await fetch('/api/actions/'+encodeURIComponent(action)+'/execute',{
    method:'POST',headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
    body:JSON.stringify({input})
  });
  const json=await reply.json();
  if(reply.status===401)emit('unauthorized');
  if(!reply.ok)throw Error(json.error||'HTTP '+reply.status);
  return json.result;
}
async function wrap(action){
  if(busy.value)return;
  busy.value=true;error.value='';output.value='';
  try{await action();}catch(e){error.value=e.message||'操作失败';}
  finally{busy.value=false;}
}
async function refreshStatus(){
  const state=await call(props.listAction);
  data.value=state;emit('listing-change',state);
}
function showSection(key){
  const obj=parse();
  section.value=key;
  if(key==='full'){sectionText.value='';sectionOriginal.value='';return;}
  const defaultValue=['inbounds','outbounds','inboundDetour','outboundDetour'].includes(key)?[]:{};
  sectionText.value=JSON.stringify(obj[key]??defaultValue,null,2);
  sectionOriginal.value=sectionText.value;
}
function commitSection(){
  if(section.value==='full'||sectionText.value===sectionOriginal.value)return;
  const obj=parse();
  let value;
  try{value=JSON.parse(sectionText.value);}catch{throw Error(names[section.value]+'不是合法 JSON');}
  obj[section.value]=value;
  draft.value=JSON.stringify(obj,null,2)+'\n';
  sectionOriginal.value=sectionText.value;
}
function selectSection(key){
  if(key===section.value)return;
  try{commitSection();showSection(key);error.value='';}catch(e){error.value=e.message;}
}
async function load(){
  const result=await call(props.operations.read);
  draft.value=result.content;original.value=result.content;revision.value=result.revision;
  loaded.value=true;showSection('full');
}
function refreshAll(){return wrap(async()=>{
  await refreshStatus();
  if(data.value.installed&&data.value.configExists)await load();
  else loaded.value=false;
  notice.value='已读取当前配置';
});}
function validate(){return wrap(async()=>{
  commitSection();
  parse();
  const result=await call(props.operations.test,{content:draft.value});
  output.value=result.output;
  notice.value=result.message;
  if(!result.ok)error.value=result.message;
});}
function save(){return wrap(async()=>{
  commitSection();
  parse();
  const result=await call(props.operations.save,{content:draft.value,revision:revision.value});
  output.value=result.output;notice.value=result.message;
  if(!result.ok){error.value=result.message;return;}
  await refreshStatus();await load();
});}
function ask(operation){
  if(busy.value)return;
  confirm.value=operation;
  nextTick(()=>confirmDialog.value?.showModal());
}
function closeConfirm(){if(busy.value)return;confirmDialog.value?.close();confirm.value=null;}
async function proceed(){
  const operation=confirm.value;
  if(!operation)return;
  return wrap(async()=>{
    const result=operation==='install'
      ?await call(props.operations.install,{confirm:true})
      :await call(props.operations.service,{operation});
    output.value=result.output;notice.value=result.message;
    if(!result.ok){error.value=result.message;return;}
    confirmDialog.value?.close();confirm.value=null;
    await refreshStatus();
    if(operation==='install'&&data.value.configExists)await load();
  });
}
onMounted(()=>{if(data.value.installed&&data.value.configExists)void wrap(load);});
</script>

<template>
  <section class="v2ray-manager" aria-label="V2Ray 控制台">
    <div class="v2ray-summary" aria-label="V2Ray 状态摘要">
      <div class="v2ray-status-card">
        <span class="muted small">内核</span>
        <strong>{{ data.installed ? (data.version||'已安装') : '未安装' }}</strong>
      </div>
      <div class="v2ray-status-card">
        <span class="muted small">服务</span>
        <strong>{{ data.installed ? (data.service==='running'?'运行中':'已停止') : '—' }}</strong>
        <div v-if="data.installed" class="v2ray-card-actions" aria-label="V2Ray 服务控制">
          <button type="button" :disabled="busy||data.service==='running'" @click="ask('start')">启动</button>
          <button type="button" :disabled="busy||data.service!=='running'" @click="ask('stop')">停止</button>
          <button type="button" :disabled="busy" @click="ask('restart')">重启</button>
        </div>
      </div>
      <div class="v2ray-status-card">
        <span class="muted small">开机启动</span>
        <strong>{{ data.installed?(data.enabled?'已启用':'未启用'):'—' }}</strong>
        <div v-if="data.installed" class="v2ray-card-actions">
          <button type="button" :disabled="busy" @click="ask(data.enabled?'disable':'enable')">
            {{ data.enabled?'关闭开机自启':'启用开机自启' }}
          </button>
        </div>
      </div>
      <div class="v2ray-status-card">
        <span class="muted small">入站 / 出站</span>
        <strong>{{ data.inbounds }} / {{ data.outbounds }}</strong>
      </div>
    </div>
    <div class="v2ray-config-line">
      <p class="muted small v2ray-config-path">配置文件：<code>{{ data.configPath }}</code></p>
      <button type="button" :disabled="busy" @click="refreshAll">刷新状态与配置</button>
    </div>
    <p v-if="busy" class="muted small" role="status">正在处理…</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="muted small" role="status">{{ notice }}</p>
    <p v-if="data.installed&&!data.configExists" class="error">没有找到主配置，请先确认 V2Ray 的实际配置文件路径。</p>
    <div v-if="!data.installed" class="v2ray-empty">
      <p>未找到 V2Ray 内核。可安装经过 SHA-256 固定校验的 V2Fly 5.47.0。默认只建立本机回环 SOCKS 监听，不开放公网代理端口。</p>
      <button type="button" class="primary" :disabled="busy" @click="ask('install')">安装 V2Ray 5.47.0</button>
    </div>
    <template v-else>
      <div v-if="loaded" class="v2ray-editor">
        <div class="v2ray-editor-layout">
          <nav class="v2ray-config-nav" aria-label="V2Ray 配置目录">
            <button v-for="entry in editorEntries" :key="entry.key" type="button"
              class="v2ray-config-item" :class="{selected:section===entry.key}"
              :aria-pressed="section===entry.key" :disabled="busy"
              @click="selectSection(entry.key)">{{ entry.label }}</button>
          </nav>
          <div class="v2ray-editor-content">
            <label class="v2ray-editor-label">
              {{ editorLabel }}
              <textarea v-if="section==='full'" v-model="draft" rows="22" spellcheck="false"
                :disabled="busy" aria-label="完整 V2Ray JSON 配置" />
              <textarea v-else v-model="sectionText" rows="22" spellcheck="false"
                :disabled="busy" aria-label="当前配置部分 JSON" />
            </label>
            <div class="v2ray-toolbar v2ray-editor-actions">
              <button type="button" :disabled="busy||!loaded" @click="validate">校验配置</button>
              <button type="button" class="primary" :disabled="busy||!loaded||!dirty" @click="save">保存并应用</button>
              <button type="button" :disabled="busy" @click="refreshAll">放弃修改并重新读取</button>
              <span v-if="dirty" class="muted small">存在尚未保存的更改</span>
            </div>
          </div>
        </div>
      </div>
      <p v-else-if="data.configExists" class="muted small">配置尚未读取；可点击“刷新状态与配置”。</p>
    </template>
    <pre v-if="output" class="v2ray-output" aria-label="V2Ray 命令输出">{{ output }}</pre>
    <dialog ref="confirmDialog" class="v2ray-dialog" aria-labelledby="v2ray-confirm-title" @close="confirm=null">
      <div class="v2ray-dialog-content">
        <h3 id="v2ray-confirm-title">{{ confirm==='install'?'安装 V2Ray':'确认 V2Ray 服务操作' }}</h3>
        <p v-if="confirm==='install'">将下载安装并校验 V2Fly 5.47.0 官方压缩包，创建本机回环代理配置与 v2ray.service，不会覆盖已有安装。</p>
        <p v-else>确定{{ {start:'启动',stop:'停止',restart:'重启',enable:'启用开机自启',disable:'停用开机自启'}[confirm] }} V2Ray？停止或重启可能中断当前代理连接。</p>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="v2ray-toolbar">
          <button type="button" :disabled="busy" @click="closeConfirm">取消</button>
          <button type="button" class="primary" :disabled="busy" @click="proceed">确认操作</button>
        </div>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.v2ray-manager{min-width:0}
.v2ray-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:.3rem 0 1rem}
.v2ray-manager button{box-sizing:border-box;min-height:32px;padding:4px 10px;
  border:1px solid var(--button-border);border-radius:999px;background:var(--button-bg);
  color:var(--button-text);font:inherit;font-size:.85rem;cursor:pointer}
.v2ray-manager button.primary{background:var(--accent-bg);color:var(--button-primary-text);border-color:var(--accent-bg)}
.v2ray-manager button:disabled{opacity:.5;cursor:not-allowed}
/* Four standalone framed status cards; service and autostart controls belong to their cards. */
.v2ray-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 18px}
.v2ray-summary>.v2ray-status-card{display:flex;flex-direction:column;gap:5px;min-width:0;padding:14px;
  border:1px solid var(--border-panel);border-radius:14px;box-shadow:none;background:var(--panel-bg)}
.v2ray-summary strong{overflow-wrap:anywhere}
.v2ray-card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:12px}
.v2ray-card-actions button{flex:none;min-width:0;padding:4px 8px}
.v2ray-config-line{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;
  flex-wrap:wrap;margin:0 0 16px}
.v2ray-config-line .v2ray-config-path{min-width:0;flex:1 1 auto;margin:0}
.v2ray-config-line button{flex:none;margin-left:auto}
.v2ray-manager code{overflow-wrap:anywhere}
.v2ray-empty{display:grid;gap:10px}
.v2ray-editor-layout{display:grid;grid-template-columns:minmax(145px,200px) minmax(0,1fr);
  gap:16px;align-items:start;min-width:0}
.v2ray-config-nav{display:flex;flex-direction:column;align-items:stretch;gap:3px;min-width:0;
  max-height:min(75vh,38rem);overflow-y:auto;overscroll-behavior:contain}
.v2ray-config-nav .v2ray-config-item{box-sizing:border-box;display:block;width:100%;flex:none;
  padding:9px 11px;border:0;border-radius:8px;text-align:left;white-space:normal;
  background:transparent;color:var(--text-primary);font:inherit;font-size:.86rem}
.v2ray-config-nav .v2ray-config-item.selected{background:var(--accent-bg);color:var(--button-primary-text)}
.v2ray-config-nav .v2ray-config-item:hover:not(:disabled):not(.selected){background:var(--button-bg)}
.v2ray-editor-content{min-width:0}
.v2ray-editor-actions{margin:12px 0 0}
.v2ray-editor-label{display:grid;gap:8px;font-weight:600}
.v2ray-editor-label textarea{box-sizing:border-box;display:block;width:100%;min-width:0;
  font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.85rem;
  padding:12px;border-radius:10px;border:1px solid var(--input-border);
  background:var(--input-bg);color:var(--text-primary);resize:vertical}
.v2ray-output{padding:10px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;
  background:transparent;border:0;border-top:1px solid var(--border-rule);border-radius:0}
.v2ray-dialog{background:var(--panel-bg);color:var(--text-primary);border:1px solid var(--border-panel);
  border-radius:12px;padding:18px;width:min(94vw,35rem);max-height:85dvh}
.v2ray-dialog::backdrop{background:#0008}
.v2ray-dialog-content{display:grid;gap:12px}
.v2ray-dialog-content h3{margin:0}
@media(max-width:730px){
  .v2ray-summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .v2ray-editor-layout{grid-template-columns:minmax(105px,128px) minmax(0,1fr);gap:10px}
  .v2ray-config-nav .v2ray-config-item{padding:8px 7px;font-size:.8rem}
  .v2ray-editor-label textarea{padding:8px}
  .v2ray-dialog{padding:14px}
}
</style>
