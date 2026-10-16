<script setup>
import { defineAsyncComponent, onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue';
import ResultRenderer from './ResultRenderer.vue';

const FileBrowser=defineAsyncComponent(()=>import('./FileBrowser.vue'));
const ScheduledTasks=defineAsyncComponent(()=>import('./ScheduledTasks.vue'));
const ManagedConfigs=defineAsyncComponent(()=>import('./ManagedConfigs.vue'));
const props=defineProps({
  action:{type:Object,required:true},presentation:{type:Object,default:null},csrf:{type:String,required:true}
});
const emit=defineEmits(['unauthorized']);
const minimal=computed(()=>['minimal','flat'].includes(props.presentation?.chrome));
const flat=computed(()=>props.presentation?.chrome==='flat');
const inputText=ref('{}'),response=ref(null),error=ref(''),busy=ref(false);
const view=ref('visual'),autoRefresh=ref(false),infoTab=ref(null);
const formInput=ref(Object.fromEntries((props.presentation?.inputs ?? []).map(field=>[field.key,props.action.inputSchema?.properties?.[field.key]?.default ?? ''])));
const inputReady=computed(()=>(props.action.inputSchema?.required ?? []).every(key=>!props.presentation?.inputs || String(formInput.value[key] ?? '').trim().length>0));
const filePath=ref('/');
const displayedResult=computed(()=>{
  const result=response.value?.content.result,filters=props.presentation?.clientFilters;
  if(!result || !filters)return result;
  const rowsKey=props.presentation.rowsKey;
  const rows=(result[rowsKey] ?? []).filter(row=>filters.every(filter=>{
    const value=String(formInput.value[filter.key] ?? '').trim();
    return !value || (filter.match==='contains'?String(row[filter.field]).toLowerCase().includes(value.toLowerCase()):String(row[filter.field])===value);
  }));
  return {...result,[rowsKey]:rows,count:rows.length};
});
const fields=ref([]),commandsLoaded=ref(false),commandsEditable=ref(false);
const commandBusy=ref(false),commandError=ref(''),commandMessage=ref('');
const refreshSeconds=computed(()=>(props.presentation?.refreshIntervalMs ?? 0)/1000);
const hasInputFields=computed(()=>Object.keys(props.action.inputSchema?.properties ?? {}).length>0);
let refreshTimer,controller,commandController;
let generation=0,disposed=false;

// Fit both edited values and wrapped lines after loading or resizing.
const autoHeightState=new WeakMap();
function fitCommand(node) {
  node.style.height='0px';
  const style=getComputedStyle(node);
  node.style.height=(node.scrollHeight+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth))+'px';
}
const vAutoHeight={
  mounted(node) {
    const fit=()=>fitCommand(node);
    let width=-1;
    const observer=new ResizeObserver(()=>{
      if(node.clientWidth!==width){width=node.clientWidth;fit();}
    });
    autoHeightState.set(node,{fit,observer});
    node.addEventListener('input',fit);
    observer.observe(node);
    nextTick(()=>{if(node.isConnected)fit();});
  },
  updated:fitCommand,
  beforeUnmount(node) {
    const state=autoHeightState.get(node);
    state?.observer.disconnect();
    node.removeEventListener('input',state?.fit);
    autoHeightState.delete(node);
  }
};

async function commandRequest(method='GET') {
  commandController=new AbortController();
  const reply=await fetch('/api/actions/'+encodeURIComponent(props.action.id)+'/commands',{
    method,signal:commandController.signal,
    headers:method==='PUT'?{'Content-Type':'application/json','X-Panel-CSRF':props.csrf}:{},
    ...(method==='PUT'?{body:JSON.stringify({commands:Object.fromEntries(fields.value.map(field=>[field.key,field.value]))})}:{})
  });
  const payload=await reply.json();
  if(reply.status===401)emit('unauthorized');
  if(!reply.ok)throw new Error(payload.error || 'HTTP '+reply.status);
  return payload;
}
async function selectInfo(tab) {
  infoTab.value=infoTab.value===tab?null:tab;
  if(infoTab.value!=='commands' || commandsLoaded.value || commandBusy.value)return;
  commandBusy.value=true;commandError.value='';
  try {
    const config=await commandRequest();
    if(disposed)return;
    fields.value=config.fields;commandsEditable.value=config.editable;commandsLoaded.value=true;
  } catch(cause) {
    if(!disposed && cause.name!=='AbortError')commandError.value=cause.message;
  } finally {if(!disposed)commandBusy.value=false;}
}
async function saveCommands() {
  if(commandBusy.value)return;
  commandBusy.value=true;commandError.value='';commandMessage.value='';
  try {
    const config=await commandRequest('PUT');
    if(!disposed){fields.value=config.fields;commandMessage.value='已保存';}
  } catch(cause) {
    if(!disposed && cause.name!=='AbortError')commandError.value=cause.message;
  } finally {if(!disposed)commandBusy.value=false;}
}
async function run(operation,refresh=false) {
  if(busy.value || disposed)return;
  const requestId=++generation;
  busy.value=true;error.value='';
  controller=new AbortController();
  try {
    const reply=await fetch('/api/actions/'+encodeURIComponent(props.action.id)+'/'+operation,{
      method:'POST',headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
      body:JSON.stringify({input:props.presentation?.renderer==='files'?{path:filePath.value}:props.presentation?.clientFilters?{}:props.presentation?.inputs ? formInput.value : JSON.parse(inputText.value)}),signal:controller.signal
    });
    const payload=await reply.json();
    if(reply.status===401)emit('unauthorized');
    if(!reply.ok)throw new Error(payload.error || 'HTTP '+reply.status);
    if(disposed || generation!==requestId)return;
    response.value={operation,content:payload};
    if(!refresh)view.value='visual';
  } catch(cause) {
    if(disposed || generation!==requestId || cause.name==='AbortError')return;
    error.value='操作失败：'+cause.message;
    if(refresh)autoRefresh.value=false;
  } finally {
    if(!disposed && generation===requestId){busy.value=false;controller=undefined;}
  }
}
watch([autoRefresh,refreshSeconds],()=>{
  if(refreshTimer)clearInterval(refreshTimer);
  refreshTimer=undefined;
  const interval=props.presentation?.refreshIntervalMs ?? 0;
  if(!autoRefresh.value || interval<3000)return;
  refreshTimer=setInterval(()=>{
    if(document.visibilityState==='visible' && !busy.value && response.value?.operation==='execute')
      void run('execute',true);
  },interval);
});
onMounted(()=>{
  if(props.action.kind==='read' && props.presentation?.loadOnEnter===true &&
    !props.action.inputSchema?.required?.length && document.visibilityState==='visible')
    void run('execute');
});
onUnmounted(()=>{
  disposed=true;generation++;
  if(refreshTimer)clearInterval(refreshTimer);
  controller?.abort();commandController?.abort();
});
</script>

<template>
  <section class="action-card" :class="{'minimal-action':minimal,'flat-action':flat,'unboxed-manager':presentation?.headerLayout==='inline'}" :aria-label="action.title">
    <div v-if="!flat" class="card-heading">
      <h3>{{ action.title }}</h3>
      <div v-if="presentation?.headerLayout==='inline'" class="module-header-actions"
        :id="'action-heading-actions-'+action.id.replaceAll('.','-')"></div>
      <div v-if="!minimal" class="action-info-tabs" role="tablist" :aria-label="action.title + '信息'">
          <button type="button" role="tab" :id="'description-tab-'+action.id"
            :aria-selected="infoTab==='description'" :aria-controls="'description-'+action.id"
            @click="selectInfo('description')">说明</button>
          <button type="button" role="tab" :id="'commands-tab-'+action.id"
            :aria-selected="infoTab==='commands'" :aria-controls="'commands-'+action.id"
            @click="selectInfo('commands')">命令</button>
        </div>
    </div>
    <div v-if="infoTab" class="action-information">
      <div v-if="infoTab==='description'" class="info-panel description-panel" role="tabpanel"
        :id="'description-'+action.id" :aria-labelledby="'description-tab-'+action.id">
        <p>{{ action.description }}</p>
        <p v-if="action.explain">{{ action.explain }}</p>
      </div>
      <div v-if="infoTab==='commands'" class="info-panel commands-panel" role="tabpanel"
        :id="'commands-'+action.id" :aria-labelledby="'commands-tab-'+action.id">
        <p v-if="commandBusy && !commandsLoaded" class="muted small">正在加载命令…</p>
        <p v-if="commandError" class="error" role="alert">{{ commandError }}</p>
        <template v-if="commandsLoaded">
          <form v-if="commandsEditable" @submit.prevent="saveCommands">
            <table class="command-table">
              <thead><tr><th>key</th><th>value（终端命令）</th></tr></thead>
              <tbody><tr v-for="field in fields" :key="field.key">
                <td><code>{{ field.key }}</code></td>
                <td><textarea v-auto-height v-model="field.value" :aria-label="'命令 '+field.key"
                  required maxlength="2048" rows="1" spellcheck="false" :disabled="commandBusy" /></td>
              </tr></tbody>
            </table>
            <button type="submit" class="command-save primary form-button" :disabled="commandBusy">保存</button>
            <p v-if="commandMessage" class="notice success-notice" role="status">{{ commandMessage }}</p>
          </form>
          <p v-else class="muted small">{{ presentation?.inputs ? '此操作通过输入参数指定执行内容。' : '此操作没有可编辑的 Linux 终端命令。' }}</p>
        </template>
      </div>
    </div>

    <div v-if="presentation?.inputs" class="action-inputs" :class="{ 'compact-inputs': presentation.inputs.every(field => field.type !== 'textarea') }">
      <strong>{{ presentation.inputsLabel ?? '输入' }}</strong>
      <label v-for="field in presentation.inputs" :key="field.key" :for="'field-'+action.id+'-'+field.key">
        <span>{{ field.label }}</span>
        <select v-if="field.type==='select'" :id="'field-'+action.id+'-'+field.key" v-model="formInput[field.key]" :disabled="busy">
          <option value="">全部</option>
          <option v-for="option in response?.content.result?.[field.optionsKey] ?? []" :key="option" :value="option">{{ option }}</option>
        </select>
        <input v-else-if="field.type==='text'" :id="'field-'+action.id+'-'+field.key" v-model="formInput[field.key]"
          type="text" :placeholder="field.placeholder" :maxlength="action.inputSchema.properties[field.key].maxLength"
          :required="action.inputSchema.required?.includes(field.key)" :disabled="busy" @keydown.enter.prevent="presentation.clientFilters ? null : run('execute')" />
        <textarea v-else :id="'field-'+action.id+'-'+field.key" v-model="formInput[field.key]" rows="4"
          :placeholder="field.placeholder" :maxlength="action.inputSchema.properties[field.key].maxLength"
          :required="action.inputSchema.required?.includes(field.key)" :disabled="busy" spellcheck="false" />
      </label>
    </div>
    <label v-else-if="hasInputFields && presentation?.renderer!=='files'" :for="'input-'+action.id">JSON 参数</label>
    <textarea v-if="hasInputFields && !presentation?.inputs && presentation?.renderer!=='files'" :id="'input-'+action.id" v-model="inputText" rows="3" spellcheck="false" />

    <div class="result">
      <div v-if="!minimal" class="result-header">
        <strong>操作结果</strong>
        <div class="result-controls">
          <button type="button" class="action-refresh primary" :disabled="busy || commandBusy || !inputReady" @click="run('execute')">
            {{ busy ? '处理中…' : presentation?.renderer === 'terminal' ? '执行命令' : action.kind === 'write' ? '申请更新' : '刷新数据' }}
          </button>
          <div v-if="response" class="view-switch" aria-label="结果查看模式">
            <button type="button" :class="{active:view==='visual'}" @click="view='visual'">可视化</button>
            <button type="button" :class="{active:view==='json'}" @click="view='json'">原始数据</button>
          </div>
        </div>
      </div>
      <div v-if="error" class="error" role="alert">{{ error }}</div>
      <button v-if="minimal && error" type="button" :disabled="busy" @click="run('execute')">重试</button>
      <label v-if="response && refreshSeconds>0" class="refresh-choice">
        <input type="checkbox" v-model="autoRefresh" />每 {{ refreshSeconds }} 秒自动刷新
        <span class="muted">（默认关闭）</span>
      </label>
      <template v-if="response">
        <FileBrowser v-if="view==='visual' && presentation?.renderer==='files'" :initial-data="response.content.result"
          :list-action="action.id" :operations="presentation.operations" :csrf="csrf"
          @path-change="filePath=$event" @listing-change="response.content.result=$event" @unauthorized="emit('unauthorized')" />
        <ScheduledTasks v-else-if="view==='visual' && presentation?.renderer==='scheduled-tasks'"
          :initial-data="response.content.result" :list-action="action.id" :operations="presentation.operations" :csrf="csrf"
          @listing-change="response.content.result=$event" @unauthorized="emit('unauthorized')" />
        <ManagedConfigs v-else-if="view==='visual' && presentation?.renderer==='managed-configs'"
          :initial-data="response.content.result" :list-action="action.id" :operations="presentation.operations"
          :labels="presentation.labels" :csrf="csrf" @listing-change="response.content.result=$event"
          @unauthorized="emit('unauthorized')" />
        <ResultRenderer v-else-if="view==='visual'" :data="displayedResult" :presentation="presentation" />
        <div v-else class="raw-data">
          <template v-if="response.content.raw">
            <table class="command-table raw-command-table">
              <thead><tr><th>key</th><th>value（原始输出）</th></tr></thead>
              <tbody><tr v-for="(output,key) in response.content.raw" :key="key">
                <td><code>{{ key }}</code></td>
                <td><pre class="command-stdout">{{ output.stdout }}</pre>
                  <template v-if="output.stderr"><strong>stderr</strong><pre class="command-stdout">{{ output.stderr }}</pre></template>
                  <small class="muted">退出码：{{ output.exitCode }}</small>
                </td>
              </tr></tbody>
            </table>
            <details class="raw-json"><summary>原始 JSON</summary>
              <pre class="raw-output">{{ JSON.stringify(response.content.raw,null,2) }}</pre>
            </details>
          </template>
          <p v-else class="muted small">此操作未执行终端命令，没有终端原始输出。</p>
        </div>
      </template>
      <p v-else-if="busy && !error" class="empty-state" role="status">正在读取实时数据…</p>
      <p v-else-if="!error" class="empty-state">{{ presentation?.renderer === 'terminal' ? '输入命令后点击“执行命令”。' : action.kind === 'write' ? '此操作只生成待批准的更新申请，不会立即部署。' : '尚未读取数据，可点击“刷新数据”。' }}</p>
    </div>
  </section>
</template>
