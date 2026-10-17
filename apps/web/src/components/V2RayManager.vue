<script setup>
import {computed,nextTick,onMounted,ref,watch} from 'vue';
import {VISUAL_SECTIONS,visualEntries,supportsVisual,formatList,patchVisual,routingConditionVisible,availableRoutingConditions} from './v2ray-visual.js';
import {v2raySelectChoices,v2rayRoutingTagChoices} from './v2ray-choices.js';
const props=defineProps({
  initialData:{type:Object,required:true},listAction:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true}
});
const emit=defineEmits(['unauthorized','listing-change']);
const data=ref(props.initialData),busy=ref(false),error=ref(''),notice=ref(''),output=ref('');
const draft=ref(''),revision=ref(''),original=ref(''),loaded=ref(false);
const section=ref('full'),sectionText=ref(''),sectionOriginal=ref(''),editorMode=ref('json');
const confirm=ref(null),confirmDialog=ref(null);
const renameDialog=ref(null),renameTarget=ref(null),renameTag=ref('');
const addFieldDialog=ref(null),newField=ref('');
function openRouteRename(source,index,entry){
  if(busy.value||source!=='routing')return;
  renameTarget.value={source,index};
  // The rule's tag is independent from its outboundTag, which is merely
  // a heading fallback. Never prefill this editor with an outbound label.
  renameTag.value=typeof entry.tag==='string'?entry.tag:'';
  nextTick(()=>renameDialog.value?.showModal());
}
function closeRouteRename(){renameDialog.value?.close();}
function submitRouteRename(){
  if(busy.value||!renameTarget.value)return;
  const {source,index}=renameTarget.value;
  try{
    const entry=visualEntries(parse(),source)[index];
    if(!entry||typeof entry!=='object')throw Error('规则已不存在');
    const value=renameTag.value;
    if((entry.tag??'')!==value){
      // Empty names delete tag, but never touch outboundTag or the rule number.
      const changed=changeVisual(source,'set',[index,'tag'],value);
      if(!changed)return;
    }
    closeRouteRename();
  }catch(e){error.value=e.message;}
}
const routeExpanded=ref({}),routeConditionSelection=ref({});
const routeKey=(source,index)=>source+':'+index;
const routeVisible=(entry,condition,source,index)=>
  routingConditionVisible(entry,condition,routeExpanded.value[routeKey(source,index)]??[]);
const routeChoices=(entry,source,index)=>
  availableRoutingConditions(entry,routeExpanded.value[routeKey(source,index)]??[]);
function chooseRouteCondition(source,index,event){
  routeConditionSelection.value={...routeConditionSelection.value,
    [routeKey(source,index)]:event.target.value};
}
function addRouteCondition(entry,source,index){
  const id=routeKey(source,index),choice=routeConditionSelection.value[id];
  if(!routeChoices(entry,source,index).some(option=>option.key===choice))return;
  routeExpanded.value={...routeExpanded.value,
    [id]:[...(routeExpanded.value[id]??[]),choice]};
  routeConditionSelection.value={...routeConditionSelection.value,[id]:''};
}
function resizeRouteIpTextarea(el){
  el.style.height='auto';
  el.style.height=Math.max(el.scrollHeight+2,36)+'px';
}
// Resize on initial mount, reactive updates and every keystroke. Not Chromium-only CSS.
const vAutoGrow={
  mounted:resizeRouteIpTextarea,
  updated:resizeRouteIpTextarea
};
const sections=['inbounds','outbounds','routing','dns','transport','log','policy','api','stats','reverse','observatory','burstObservatory','metrics','inboundDetour','outboundDetour'];
const names={inbounds:'入站连接',outbounds:'出站连接',routing:'路由规则',dns:'DNS',transport:'传输设置',
  log:'日志',policy:'流量策略',api:'API',stats:'统计',reverse:'反向代理',observatory:'观测',
  burstObservatory:'突发观测',metrics:'指标',inboundDetour:'旧版入站扩展',outboundDetour:'旧版出站扩展'};
const parse=()=>{const obj=JSON.parse(draft.value);if(!obj||Array.isArray(obj)||typeof obj!=='object')throw Error('配置必须是 JSON 对象');return obj;};
const dirty=computed(()=>draft.value!==original.value||
  (section.value!=='full'&&sectionText.value!==sectionOriginal.value));
// Show only configured keys. Missing known keys can be created explicitly by
// the Add field dialog; never synthesize them merely by visiting a section.
const editorEntries=computed(()=>{
  let cfg;
  try{cfg=parse();}catch{return [{key:'full',label:'完整内容（JSON 根对象）'}];}
  return [{key:'full',label:'完整内容（JSON 根对象）'},
    ...sections.filter(key=>Object.hasOwn(cfg,key))
      .map(key=>({key,label:names[key]+'（'+key+'）'}))];
});
const missingFields=computed(()=>{
  try{const cfg=parse();return sections.filter(key=>!Object.hasOwn(cfg,key));}
  catch{return [];}
});
const fieldOptions=computed(()=>missingFields.value.map(key=>({key,label:names[key]+'（'+key+'）'})));
function openAddField(){
  if(busy.value)return;
  try{
    commitSection();
    const list=missingFields.value;
    if(!list.length)return;
    newField.value='';
    error.value='';
    nextTick(()=>addFieldDialog.value?.showModal());
  }catch(e){error.value=e.message;}
}
function closeAddField(){addFieldDialog.value?.close();}
function confirmAddField(){
  if(busy.value||!missingFields.value.includes(newField.value))return;
  try{
    commitSection();
    const cfg=parse(),key=newField.value;
    if(Object.hasOwn(cfg,key))throw Error('该字段已经存在');
    // Preserve each section's JSON type; initialize only after confirmation.
    cfg[key]=['inbounds','outbounds','inboundDetour','outboundDetour'].includes(key)?[]
      :key==='routing'?{rules:[]}:{};
    draft.value=JSON.stringify(cfg,null,2)+'\n';
    showSection(key);
    editorMode.value=visualAvailable.value?'visual':'json';
    routeExpanded.value={};routeConditionSelection.value={};
    closeAddField();
    error.value='';
  }catch(e){error.value=e.message;}
}
const editorLabel=computed(()=>section.value==='full'?'完整 V2Ray JSON 配置（根对象）':names[section.value]+'（'+section.value+'） · JSON');
const visualAvailable=computed(()=>{
  try{return supportsVisual(parse(),section.value);}catch{return false;}
});
const visualGroups=computed(()=>{
  if(!visualAvailable.value)return [];
  const cfg=parse(),key=section.value;
  // A section owns only its own list, including legacy in-/outbound detours.
  const keys=[key];
  return keys.filter(source=>supportsVisual(cfg,source))
    .map(source=>({key:source,label:names[source],items:visualEntries(cfg,source)}));
});
const listString=value=>formatList(value);
const selectChoices=v2raySelectChoices;
const routingTagChoices=(direction,current)=>{
  try{return v2rayRoutingTagChoices(parse(),direction,current);}
  catch{return v2rayRoutingTagChoices({},direction,current);}
};
function changeVisual(source,action,path=[],value,kind='text',item){
  try{
    const cfg=patchVisual(parse(),source,{action,path,value,kind,item});
    if(source==='routing'){
      if((action==='add'&&path.length===0)||(action==='remove'&&path.length===1)){
        routeExpanded.value={};routeConditionSelection.value={};
      }else if(action==='set'&&path.length===2 && String(value??'').trim()===''){
        const id=routeKey(source,path[0]);
        routeExpanded.value={...routeExpanded.value,
          [id]:(routeExpanded.value[id]??[]).filter(key=>key!==path[1])};
      }
    }
    draft.value=JSON.stringify(cfg,null,2)+'\n';
    showSection(section.value);error.value='';return true;
  }catch(e){error.value=e.message;return false;}
}
function visualSet(source,path,event,kind='text'){
  changeVisual(source,'set',path,event.target.value,kind);
}
function visualAdd(source,path,item){changeVisual(source,'add',path,undefined,'text',item);}
function visualRemove(source,path){changeVisual(source,'remove',path);}
function addConnection(source){
  visualAdd(source,[],source==='routing'?{type:'field',inboundTag:[],outboundTag:''}:{tag:'',protocol:'',settings:{}});
}
function setEditorMode(next){
  if(next===editorMode.value||busy.value)return;
  if(next==='visual'&&!visualAvailable.value)return;
  try{commitSection();showSection(section.value);editorMode.value=next;error.value='';}
  catch(e){error.value=e.message;}
}
watch(()=>props.initialData,v=>{data.value=v;});
async function call(action,input={}){
  const reply=await fetch('/api/actions/'+encodeURIComponent(action)+'/execute',{
    method:'POST',headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
    body:JSON.stringify({input})
  });
  const json=await reply.json();
  if(reply.status===401)emit('unauthorized');
  if(!reply.ok){const failure=Error(json.error||'HTTP '+reply.status);failure.status=reply.status;throw failure;}
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
  // A present null legacy field must remain "null", never an invented [].
  sectionText.value=JSON.stringify(obj[key]===undefined?defaultValue:obj[key],null,2);
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
  try{
    commitSection();showSection(key);
    routeExpanded.value={};routeConditionSelection.value={};
    editorMode.value=visualAvailable.value?'visual':'json';error.value='';
  }
  catch(e){error.value=e.message;}
}
async function load(){
  const result=await call(props.operations.read);
  draft.value=result.content;original.value=result.content;revision.value=result.revision;
  loaded.value=true;showSection('full');editorMode.value='json';
  routeExpanded.value={};routeConditionSelection.value={};
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
  let result;
  try{result=await call(props.operations.save,{content:draft.value,revision:revision.value});}
  catch(e){
    if(e.status===409){
      error.value='配置文件自本页读取后已变化。你的本地修改仍保留，未覆盖服务器配置；请先备份当前草稿，再重新读取最新版本并合并修改。';
      return;
    }
    throw e;
  }
  output.value=result.output;notice.value=result.message;
  if(!result.ok){error.value=result.message;return;}
  // The backend has now committed this revision. Remember it immediately.
  // A transient status refresh failure must not strand the next Save on the
  // previous SHA (even though this save has succeeded).
  revision.value=result.revision;
  original.value=draft.value;
  try{await load();}
  catch{
    notice.value=result.message+'；重新读取暂不可用，本页已保存新的版本标识';
    return;
  }
  try{await refreshStatus();}
  catch{notice.value=result.message+'；状态摘要刷新失败，可稍后手动刷新';}
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
            <button type="button" class="v2ray-field-add-button"
              :disabled="busy||!missingFields.length" @click="openAddField">添加字段</button>
            <div class="v2ray-config-full-card">
              <button type="button" class="v2ray-config-item v2ray-config-full"
                :class="{selected:section==='full'}" :aria-pressed="section==='full'"
                :disabled="busy" @click="selectSection('full')">{{ editorEntries[0].label }}</button>
            </div>
            <div v-if="editorEntries.length>1" class="v2ray-config-fields-card"
              role="group" aria-label="已配置字段">
              <button v-for="entry in editorEntries.slice(1)" :key="entry.key" type="button"
                class="v2ray-config-item" :class="{selected:section===entry.key}"
                :aria-pressed="section===entry.key" :disabled="busy"
                @click="selectSection(entry.key)">{{ entry.label }}</button>
            </div>
          </nav>
          <div class="v2ray-editor-content">
            <div class="v2ray-editor-header">
              <div class="v2ray-toolbar v2ray-editor-actions">
                <button type="button" :disabled="busy||!loaded" @click="validate">校验配置</button>
                <button type="button" class="primary" :disabled="busy||!loaded||!dirty" @click="save">保存并应用</button>
                <button type="button" :disabled="busy" @click="refreshAll">放弃修改并重新读取</button>
                <span v-if="dirty" class="muted small">存在尚未保存的更改</span>
              </div>
              <div class="v2ray-view-toggle" aria-label="配置编辑方式">
                <button type="button" :aria-pressed="editorMode==='visual'"
                  :disabled="busy||!visualAvailable" @click="setEditorMode('visual')">可视化</button>
                <button type="button" :aria-pressed="editorMode==='json'"
                  :disabled="busy" @click="setEditorMode('json')">JSON</button>
              </div>
            </div>
            <p v-if="section==='full'" class="muted small">完整配置使用 JSON 编辑；入站、出站和路由可在左侧选择后切换可视化。</p>
            <p v-else-if="!visualAvailable" class="muted small">当前分类使用 JSON 编辑，或其结构不适合可视化。</p>
            <div v-if="editorMode==='visual'&&visualAvailable" class="v2ray-visual-editor" aria-label="V2Ray 可视化配置">
              <template v-for="group in visualGroups" :key="group.key">
                <div class="v2ray-visual-group-heading">
                  <strong>{{ group.label }}（{{ group.key }}） · {{ group.items.length }}</strong>
                  <button type="button" :disabled="busy" @click="addConnection(group.key)">
                    {{ section==='routing'?'新增规则':'新增连接' }}
                  </button>
                </div>
                <p v-if="!group.items.length" class="muted small">暂无条目，可点击新增。</p>
                <div v-for="(entry,i) in group.items" :key="group.key+'-'+i" class="v2ray-visual-entry">
                  <div class="v2ray-visual-entry-heading">
                    <strong>{{ section==='routing'?'规则': '连接' }} {{ i+1 }} · {{ entry.tag||entry.outboundTag||entry.protocol||'未命名' }}</strong>
                    <div class="v2ray-visual-entry-actions">
                      <button v-if="section==='routing'" type="button" :disabled="busy"
                        :aria-label="'重命名路由规则 '+(i+1)" @click="openRouteRename(group.key,i,entry)">重命名</button>
                      <button type="button" :disabled="busy"
                        :aria-label="'移除'+group.label+(i+1)" @click="visualRemove(group.key,[i])">移除</button>
                    </div>
                  </div>
                  <div v-if="section==='routing'" class="v2ray-visual-fields v2ray-routing-fields">
                    <label class="v2ray-route-base-field"><span>类型（type）</span>
                      <input :value="entry.type??''" :disabled="busy" @change="visualSet(group.key,[i,'type'],$event)" />
                    </label>
                    <div class="v2ray-routing-tags">
                      <span>入站标签（inboundTag）</span>
                      <template v-if="entry.inboundTag===undefined||Array.isArray(entry.inboundTag)">
                        <div v-for="(tag,j) in (entry.inboundTag??[])" :key="j" class="v2ray-routing-tag-row">
                          <select :value="tag" :disabled="busy" :aria-label="'入站标签 '+(j+1)"
                            @change="visualSet(group.key,[i,'inboundTag',j],$event)">
                            <option v-for="choice in routingTagChoices('inbound',tag)"
                              :key="choice.value" :value="choice.value"
                              :disabled="choice.value===''">{{ choice.label }}</option>
                          </select>
                          <button type="button" :disabled="busy" :aria-label="'移除入站标签 '+(j+1)"
                            @click="visualRemove(group.key,[i,'inboundTag',j])">移除</button>
                        </div>
                        <button type="button" :disabled="busy"
                          @click="visualAdd(group.key,[i,'inboundTag'],'')">添加入站标签</button>
                      </template>
                      <span v-else class="muted small">此字段不是标签数组，请在 JSON 模式修改。</span>
                    </div>
                    <label class="v2ray-route-base-field"><span>目标出站标签（outboundTag）</span>
                      <select :value="entry.outboundTag??''" :disabled="busy" aria-label="目标出站标签"
                        @change="visualSet(group.key,[i,'outboundTag'],$event)">
                        <option v-for="choice in routingTagChoices('outbound',entry.outboundTag)"
                          :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                      </select>
                    </label>
                    <label v-if="routeVisible(entry,'balancerTag',group.key,i)">平衡器标签（balancerTag）
                      <input :value="entry.balancerTag??''" :disabled="busy"
                        @change="visualSet(group.key,[i,'balancerTag'],$event)" />
                    </label>
                    <label v-if="routeVisible(entry,'port',group.key,i)">端口条件（port）
                      <input :value="entry.port??''" :disabled="busy"
                        @change="visualSet(group.key,[i,'port'],$event)" />
                    </label>
                    <label v-if="routeVisible(entry,'network',group.key,i)">网络条件（network）
                      <input :value="entry.network??''" :disabled="busy"
                        @change="visualSet(group.key,[i,'network'],$event)" />
                    </label>
                    <label v-if="routeVisible(entry,'source',group.key,i)">来源 IP（source）
                      <textarea rows="2" :value="listString(entry.source)" :disabled="busy"
                        @change="visualSet(group.key,[i,'source'],$event,'list')" />
                    </label>
                    <label v-if="routeVisible(entry,'domain',group.key,i)">域名条件（domain）
                      <textarea rows="2" :value="listString(entry.domain)" :disabled="busy"
                        @change="visualSet(group.key,[i,'domain'],$event,'list')" />
                    </label>
                    <label v-if="routeVisible(entry,'protocol',group.key,i)">协议条件（protocol）
                      <textarea rows="2" :value="listString(entry.protocol)" :disabled="busy"
                        @change="visualSet(group.key,[i,'protocol'],$event,'list')" />
                    </label>
                    <label v-if="routeVisible(entry,'ip',group.key,i)" class="v2ray-routing-ip-field">IP 条件（ip）
                      <textarea v-auto-grow rows="1" :value="listString(entry.ip)" :disabled="busy"
                        @input="resizeRouteIpTextarea($event.target)"
                        @change="visualSet(group.key,[i,'ip'],$event,'list')" />
                    </label>
                    <div class="v2ray-routing-add-condition">
                      <select :value="routeConditionSelection[routeKey(group.key,i)]??''" :disabled="busy"
                        :aria-label="'选择条件 '+(i+1)"
                        @change="chooseRouteCondition(group.key,i,$event)">
                        <option value="">选择条件</option>
                        <option v-for="choice in routeChoices(entry,group.key,i)"
                          :key="choice.key" :value="choice.key">{{ choice.label }}</option>
                      </select>
                      <button type="button" :disabled="busy||!routeConditionSelection[routeKey(group.key,i)]"
                        @click="addRouteCondition(entry,group.key,i)">添加条件</button>
                    </div>
                  </div>
                  <template v-else>
                    <div class="v2ray-visual-fields">
                      <label>标签（tag）
                        <input :value="entry.tag??''" :disabled="busy"
                          @change="visualSet(group.key,[i,'tag'],$event)" />
                      </label>
                      <label>协议（protocol）
                        <select :value="entry.protocol??''" :disabled="busy"
                          @change="visualSet(group.key,[i,'protocol'],$event)">
                          <option v-for="choice in selectChoices(
                            group.key==='inbounds'||group.key==='inboundDetour'?'inboundProtocol':'outboundProtocol',
                            entry.protocol)" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                        </select>
                      </label>
                      <template v-if="group.key==='inbounds'||group.key==='inboundDetour'">
                        <label>监听地址（listen）
                          <select :value="entry.listen??''" :disabled="busy"
                            @change="visualSet(group.key,[i,'listen'],$event)">
                            <option v-for="choice in selectChoices('listen',entry.listen)"
                              :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                          </select>
                        </label>
                        <label>监听端口（port）
                          <input type="number" min="0" max="65535" :value="entry.port??''" :disabled="busy"
                            @change="visualSet(group.key,[i,'port'],$event,'number')" />
                        </label>
                      </template>
                      <label v-else>发送地址（sendThrough）
                        <input :value="entry.sendThrough??''" :disabled="busy"
                          @change="visualSet(group.key,[i,'sendThrough'],$event)" />
                      </label>
                      <label v-if="entry.streamSettings">传输网络（streamSettings.network）
                        <select :value="entry.streamSettings.network??''" :disabled="busy"
                          @change="visualSet(group.key,[i,'streamSettings','network'],$event)">
                          <option v-for="choice in selectChoices('network',entry.streamSettings.network)"
                            :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                        </select>
                      </label>
                      <label v-if="entry.streamSettings">传输安全（streamSettings.security）
                        <select :value="entry.streamSettings.security??''" :disabled="busy"
                          @change="visualSet(group.key,[i,'streamSettings','security'],$event)">
                          <option v-for="choice in selectChoices('security',entry.streamSettings.security)"
                            :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                        </select>
                      </label>
                    </div>
                    <div v-if="Array.isArray(entry.settings?.clients)" class="v2ray-visual-nested">
                      <div class="v2ray-visual-entry-heading"><strong>客户端（settings.clients）</strong>
                        <button type="button" :disabled="busy" @click="visualAdd(group.key,[i,'settings','clients'],{id:''})">添加客户端</button>
                      </div>
                      <div v-for="(client,j) in entry.settings.clients" :key="j" class="v2ray-visual-fields">
                        <label>客户端 {{ j+1 }} · ID（id）
                          <input type="text" autocomplete="off" :value="client.id??''" :disabled="busy"
                            @change="visualSet(group.key,[i,'settings','clients',j,'id'],$event)" />
                        </label>
                        <label>邮件标识（email）
                          <input :value="client.email??''" :disabled="busy"
                            @change="visualSet(group.key,[i,'settings','clients',j,'email'],$event)" />
                        </label>
                        <label>alterId（alterId）
                          <input type="number" min="0" max="65535" :value="client.alterId??''" :disabled="busy"
                            @change="visualSet(group.key,[i,'settings','clients',j,'alterId'],$event,'number')" />
                        </label>
                        <button type="button" :disabled="busy"
                          :aria-label="'移除客户端 '+(j+1)" @click="visualRemove(group.key,[i,'settings','clients',j])">移除客户端</button>
                      </div>
                    </div>
                    <div v-for="arrayKey in ['vnext','servers']" :key="arrayKey">
                      <div v-if="Array.isArray(entry.settings?.[arrayKey])" class="v2ray-visual-nested">
                        <div class="v2ray-visual-entry-heading"><strong>{{ arrayKey==='vnext'?'目标服务器（settings.vnext）':'服务器（settings.servers）' }}</strong>
                          <button type="button" :disabled="busy" @click="visualAdd(group.key,[i,'settings',arrayKey],{address:'',port:443})">添加服务器</button>
                        </div>
                        <div v-for="(server,j) in entry.settings[arrayKey]" :key="j" class="v2ray-server-editor">
                          <div class="v2ray-visual-fields">
                            <label>服务器 {{ j+1 }} · 地址（address）
                              <input :value="server.address??''" :disabled="busy"
                                @change="visualSet(group.key,[i,'settings',arrayKey,j,'address'],$event)" />
                            </label>
                            <label>服务器端口（port）
                              <input type="number" min="0" max="65535" :value="server.port??''" :disabled="busy"
                                @change="visualSet(group.key,[i,'settings',arrayKey,j,'port'],$event,'number')" />
                            </label>
                            <label v-if="server.method!==undefined">加密方式（method）
                              <input :value="server.method??''" :disabled="busy"
                                @change="visualSet(group.key,[i,'settings',arrayKey,j,'method'],$event)" />
                            </label>
                            <label v-if="server.password!==undefined">密码（password）
                              <input type="password" autocomplete="off" :value="server.password??''" :disabled="busy"
                                @change="visualSet(group.key,[i,'settings',arrayKey,j,'password'],$event)" />
                            </label>
                            <button type="button" :disabled="busy"
                              :aria-label="'移除服务器 '+(j+1)" @click="visualRemove(group.key,[i,'settings',arrayKey,j])">移除服务器</button>
                          </div>
                          <div v-if="Array.isArray(server.users)" class="v2ray-visual-nested">
                            <div class="v2ray-visual-entry-heading"><strong>服务器用户（users）</strong>
                              <button type="button" :disabled="busy" @click="visualAdd(group.key,[i,'settings',arrayKey,j,'users'],{id:''})">添加用户</button>
                            </div>
                            <div v-for="(user,k) in server.users" :key="k" class="v2ray-visual-fields">
                              <label>用户 {{ k+1 }} · ID（id）
                                <input type="text" autocomplete="off" :value="user.id??''" :disabled="busy"
                                  @change="visualSet(group.key,[i,'settings',arrayKey,j,'users',k,'id'],$event)" />
                              </label>
                              <label>alterId（alterId）
                                <input type="number" min="0" max="65535" :value="user.alterId??''" :disabled="busy"
                                  @change="visualSet(group.key,[i,'settings',arrayKey,j,'users',k,'alterId'],$event,'number')" />
                              </label>
                              <label>加密方式（security）
                                <input :value="user.security??''" :disabled="busy"
                                  @change="visualSet(group.key,[i,'settings',arrayKey,j,'users',k,'security'],$event)" />
                              </label>
                              <button type="button" :disabled="busy"
                                :aria-label="'移除用户 '+(k+1)" @click="visualRemove(group.key,[i,'settings',arrayKey,j,'users',k])">移除用户</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </template>
            </div>
            <label v-else class="v2ray-editor-label">
              {{ editorLabel }}
              <textarea v-if="section==='full'" v-model="draft" rows="22" spellcheck="false"
                :disabled="busy" aria-label="完整 V2Ray JSON 配置" />
              <textarea v-else v-model="sectionText" rows="22" spellcheck="false"
                :disabled="busy" aria-label="当前配置部分 JSON" />
            </label>
          </div>
        </div>
      </div>
      <p v-else-if="data.configExists" class="muted small">配置尚未读取；可点击“刷新状态与配置”。</p>
    </template>
    <pre v-if="output" class="v2ray-output" aria-label="V2Ray 命令输出">{{ output }}</pre>
    <dialog ref="addFieldDialog" class="v2ray-dialog" aria-labelledby="v2ray-add-field-title"
      @close="newField=''">
      <form class="v2ray-dialog-content" @submit.prevent="confirmAddField">
        <h3 id="v2ray-add-field-title">添加配置字段</h3>
        <label class="v2ray-rename-label" for="v2ray-new-field">选择尚未配置的字段
          <select id="v2ray-new-field" v-model="newField" :disabled="busy"
            aria-label="选择尚未配置的字段">
            <option value="">请选择字段</option>
            <option v-for="entry in fieldOptions" :key="entry.key" :value="entry.key">{{ entry.label }}</option>
          </select>
        </label>
        <div class="v2ray-toolbar">
          <button type="button" :disabled="busy" @click="closeAddField">取消</button>
          <button type="submit" class="primary" :disabled="busy||!missingFields.includes(newField)">添加</button>
        </div>
      </form>
    </dialog>
    <dialog ref="renameDialog" class="v2ray-dialog" aria-labelledby="v2ray-route-rename-title"
      @close="renameTarget=null">
      <form class="v2ray-dialog-content" @submit.prevent="submitRouteRename">
        <h3 id="v2ray-route-rename-title">重命名路由规则</h3>
        <label class="v2ray-rename-label" for="v2ray-rule-tag-input">规则标签（tag）
          <input id="v2ray-rule-tag-input" v-model="renameTag" type="text"
            autocomplete="off" :disabled="busy" aria-label="规则标签（tag）" />
        </label>
        <div class="v2ray-toolbar">
          <button type="button" :disabled="busy" @click="closeRouteRename">取消</button>
          <button type="submit" class="primary" :disabled="busy">确认</button>
        </div>
      </form>
    </dialog>
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
.v2ray-editor-layout{--v2ray-sticky-top:var(--sidebar-space,16px);
  display:grid;grid-template-columns:minmax(145px,200px) minmax(0,1fr);
  gap:16px;align-items:start;min-width:0}
/* The navigation has no shared background or scrollbar. Only the lower
   configured-fields card scrolls; Add field and Full remain stationary. */
.v2ray-config-nav{display:flex;flex-direction:column;align-items:stretch;gap:12px;min-width:0;
  position:sticky;top:var(--v2ray-sticky-top);align-self:start;z-index:4;
  max-height:calc(100dvh - var(--v2ray-sticky-top) - 14px);
  overflow:hidden;background:transparent}
.v2ray-config-full-card,.v2ray-config-fields-card{
  box-sizing:border-box;min-width:0;padding:6px;border:1px solid var(--border-panel);
  border-radius:12px;background:var(--panel-bg)
}
.v2ray-config-full-card{flex:none}
.v2ray-config-fields-card{flex:1 1 auto;min-height:0;overflow-y:auto;
  overscroll-behavior:contain;scrollbar-gutter:stable}
.v2ray-config-nav .v2ray-config-item{box-sizing:border-box;display:block;width:100%;flex:none;
  padding:9px 11px;border:0;border-radius:8px;text-align:left;white-space:normal;
  background:transparent;color:var(--text-primary);font:inherit;font-size:.86rem}
.v2ray-config-nav .v2ray-field-add-button{display:block;width:100%;flex:none;
  margin:0;border-radius:8px;padding:8px 11px;min-height:38px;text-align:center}
.v2ray-config-nav .v2ray-config-item.selected{background:var(--accent-bg);color:var(--button-primary-text)}
.v2ray-config-nav .v2ray-config-item:hover:not(:disabled):not(.selected){background:var(--button-bg)}
.v2ray-editor-content{min-width:0}
.v2ray-editor-actions{margin:12px 0 0}
.v2ray-editor-header{display:flex;align-items:center;justify-content:space-between;
  gap:8px 14px;flex-wrap:wrap;margin-bottom:12px;
  position:sticky;top:var(--v2ray-sticky-top);z-index:5;
  padding:8px 0;background:var(--page-bg)}
.v2ray-editor-header .v2ray-editor-actions{margin:0}
.v2ray-view-toggle{display:flex;align-items:center;gap:0;margin-left:auto;
  border:1px solid var(--button-border);border-radius:999px;overflow:hidden}
.v2ray-view-toggle button{border:0;border-radius:0;min-height:32px;padding:4px 11px}
.v2ray-view-toggle button[aria-pressed="true"]{background:var(--accent-bg);
  color:var(--button-primary-text)}
.v2ray-visual-editor{min-width:0;display:grid;gap:12px}
.v2ray-visual-group-heading,.v2ray-visual-entry-heading{display:flex;gap:10px;
  justify-content:space-between;align-items:center;flex-wrap:wrap}
.v2ray-visual-group-heading{margin-top:5px}
.v2ray-visual-entry-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
.v2ray-visual-entry{border-top:1px solid var(--border-rule);padding-top:14px;display:grid;gap:12px;min-width:0}
.v2ray-visual-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,175px),1fr));
  gap:10px;align-items:end;min-width:0}
.v2ray-visual-fields label{display:grid;gap:5px;min-width:0;font-size:.85rem;font-weight:600}
/* Caption titles are bold, but values (including selects and their options) never
   inherit the field's bold weight. This must apply to all visual editor sections. */
/* Routing's three permanent fields share the same top baseline, even when
   inboundTag contains several rows or its add button makes that cell taller. */
.v2ray-visual-fields.v2ray-routing-fields{align-items:start}
.v2ray-routing-fields>label>input,.v2ray-routing-fields>label>select,
.v2ray-routing-tags select,.v2ray-routing-tags>button,.v2ray-routing-tag-row button{
  box-sizing:border-box;height:38px;min-height:38px;line-height:20px
}
.v2ray-visual-fields .v2ray-routing-ip-field{grid-column:1/-1}
.v2ray-routing-ip-field textarea{resize:none;overflow-y:hidden}
.v2ray-routing-add-condition{grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}
.v2ray-routing-add-condition select{flex:1 1 175px;width:auto;min-width:0}
.v2ray-routing-add-condition button{flex:none;border-radius:8px}
.v2ray-routing-add-condition select,.v2ray-routing-add-condition button{
  box-sizing:border-box;height:38px;min-height:38px;line-height:20px
}
.v2ray-visual-fields input,.v2ray-visual-fields textarea,.v2ray-visual-fields select{
  box-sizing:border-box;width:100%;min-width:0;padding:8px;
  border-radius:8px;border:1px solid var(--input-border);
  color:var(--text-primary);background:var(--input-bg);font:inherit;font-weight:400}
.v2ray-routing-tags{display:grid;gap:5px;min-width:0;font-size:.85rem;font-weight:400}
.v2ray-routing-tags>span:first-child{font-weight:600}
.v2ray-routing-tags select,.v2ray-routing-tags button{font-weight:400}
/* The JSON-key captions can wrap on narrow screens. Reserve the same two-line
   caption slot so base inputs start at an equal top offset on any viewport. */
.v2ray-routing-fields>.v2ray-route-base-field>span,
.v2ray-routing-tags>span:first-child{display:block;min-height:42px;line-height:20px}
.v2ray-routing-tag-row{display:flex;align-items:center;gap:6px;min-width:0}
.v2ray-routing-tag-row select{flex:1 1 0;width:0}
.v2ray-routing-tags>button{justify-self:start;border-radius:8px}
.v2ray-routing-tag-row button{flex:none;border-radius:8px}
.v2ray-visual-nested,.v2ray-server-editor{display:grid;gap:10px;min-width:0;
  padding:10px 0 0 12px;border-left:2px solid var(--border-rule)}
.v2ray-editor-label{display:grid;gap:8px;font-weight:600}
.v2ray-editor-label textarea{box-sizing:border-box;display:block;width:100%;min-width:0;font-weight:400;
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
.v2ray-rename-label{display:grid;gap:6px;min-width:0;font-size:.9rem;font-weight:600}
.v2ray-rename-label input,.v2ray-rename-label select{box-sizing:border-box;width:100%;min-height:38px;padding:8px 10px;
  border:1px solid var(--input-border);border-radius:8px;background:var(--input-bg);
  color:var(--text-primary);font:inherit;font-weight:400}
@media(max-width:730px){
  .v2ray-summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .v2ray-editor-layout{--v2ray-sticky-top:calc(var(--mobile-top,16px) + var(--mobile-header-height,110px) + 10px);
    grid-template-columns:minmax(105px,128px) minmax(0,1fr);gap:10px}
  .v2ray-config-nav .v2ray-config-item{padding:8px 7px;font-size:.8rem}
  .v2ray-editor-label textarea{padding:8px}
  .v2ray-dialog{padding:14px}
}
</style>
