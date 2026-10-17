<script setup>
import {ref,watch} from 'vue';
const props=defineProps({
  initialData:{type:Object,required:true},listAction:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true}
});
const emit=defineEmits(['unauthorized','listing-change']);
const state=ref(props.initialData),busy=ref(false),error=ref(''),notice=ref(''),checkResult=ref(null);
const pending=ref(''),confirmation=ref(null);
watch(()=>props.initialData,value=>{state.value=value;});
async function request(action,input={}){
  const reply=await fetch('/api/actions/'+encodeURIComponent(action)+'/execute',{
    method:'POST',headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
    body:JSON.stringify({input})
  });
  const payload=await reply.json();
  if(reply.status===401)emit('unauthorized');
  if(!reply.ok)throw Error(payload.error||'HTTP '+reply.status);
  return payload.result;
}
async function work(fn){
  if(busy.value)return;
  busy.value=true;error.value='';notice.value='';
  try{await fn();}catch(e){error.value=e.message||'操作失败';}
  finally{busy.value=false;}
}
async function refresh(){
  const result=await request(props.listAction);
  state.value=result;emit('listing-change',result);
}
const words={start:'启动',stop:'停止',restart:'重启',reload:'重载',
  enable:'启用开机自启',disable:'关闭开机自启'};
function ask(action){
  if(busy.value)return;
  pending.value=action;
  confirmation.value?.showModal();
}
function dismiss(){if(!busy.value)confirmation.value?.close();}
function proceed(){return work(async()=>{
  const operation=pending.value;
  const result=await request(props.operations.service,{operation});
  notice.value=result.status;
  if(!result.ok){error.value=result.status+(result.output?'：'+result.output:'');return;}
  confirmation.value?.close();
  await refresh();
});}
function check(){return work(async()=>{
  const result=await request(props.operations.check);
  checkResult.value=result;
  notice.value=result.status;
  await refresh();
});}
</script>

<template>
  <section class="nginx-service" aria-label="Nginx 状态管理面板">
    <div class="nginx-service-heading">
      <h3 class="nginx-service-title">Nginx 状态管理</h3>
      <button type="button" class="nginx-service-refresh" :disabled="busy" @click="work(refresh)">刷新状态</button>
    </div>
    <div class="nginx-service-cards">
      <div class="nginx-service-card">
        <span class="muted small">Nginx 内核</span>
        <strong>{{ state.installed?(state.version||'已安装'):'未安装' }}</strong>
      </div>
      <div class="nginx-service-card">
        <span class="muted small">服务运行状态</span>
        <strong>{{ state.active?'运行中':state.state==='inactive'?'已停止':state.state }}</strong>
        <span class="muted small">{{ state.subState }}</span>
        <div class="nginx-service-buttons">
          <button type="button" :disabled="busy"
            @click="ask(state.active?'stop':'start')">{{ state.active?'停止':'启动' }}</button>
          <button type="button" :disabled="busy||!state.active" @click="ask('restart')">重启</button>
          <button type="button" :disabled="busy||!state.active" @click="ask('reload')">重载</button>
        </div>
      </div>
      <div class="nginx-service-card">
        <span class="muted small">开机自启</span>
        <strong>{{ state.enabled?'已启用':'未启用' }}</strong>
        <div class="nginx-service-buttons">
          <button type="button" :disabled="busy"
            @click="ask(state.enabled?'disable':'enable')">
            {{ state.enabled?'关闭开机自启':'启用开机自启' }}
          </button>
        </div>
      </div>
      <div class="nginx-service-card">
        <span class="muted small">配置语法</span>
        <strong>{{ state.configOk?'检查通过':'检查失败' }}</strong>
        <div class="nginx-service-buttons">
          <button type="button" :disabled="busy" @click="check">检查配置</button>
        </div>
      </div>
    </div>
    <p v-if="busy" class="muted small" role="status">正在处理…</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <details v-if="checkResult?.output">
      <summary>查看检查输出</summary>
      <pre>{{ checkResult.output }}</pre>
    </details>
    <dialog ref="confirmation" class="nginx-control-dialog" aria-labelledby="nginx-control-title"
      @close="pending=''">
      <div class="nginx-control-form">
        <h3 id="nginx-control-title">确认 Nginx 服务操作</h3>
        <p>确定要{{ words[pending] }} Nginx？</p>
        <p class="muted small">停止或重启会影响当前网站及面板入口。启动、重启和重载前先检查配置语法。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="nginx-control-actions">
          <button type="button" :disabled="busy" @click="dismiss">取消</button>
          <button type="button" :disabled="busy" @click="proceed">确认操作</button>
        </div>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.nginx-service{display:grid;gap:12px;min-width:0}
.nginx-service-heading{display:flex;align-items:center;justify-content:space-between;
  gap:12px;flex-wrap:wrap;min-width:0}
.nginx-service-title{margin:0;font-size:1.15rem;font-weight:var(--ui-label-font-weight)}
.nginx-service-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.nginx-service-card{border:1px solid var(--border-panel);border-radius:var(--ui-card-radius);
  padding:var(--ui-card-padding);background:var(--panel-bg);display:flex;flex-direction:column;gap:6px;min-width:0}
.nginx-service-card strong{overflow-wrap:anywhere}
.nginx-service-buttons{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:10px}
.nginx-service pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:16rem;overflow-y:auto}
.nginx-control-dialog{background:var(--panel-bg);color:var(--text-primary);border:1px solid var(--border-panel);
  border-radius:var(--ui-card-radius);padding:var(--ui-dialog-padding);width:min(94vw,36rem);box-shadow:var(--ui-dialog-shadow)}
.nginx-control-dialog::backdrop{background:var(--ui-dialog-backdrop)}
.nginx-control-form{display:grid;gap:12px}
.nginx-control-form h3,.nginx-control-form p{margin:0}
.nginx-control-actions{display:flex;gap:8px;justify-content:flex-end}
@media(max-width:1050px){.nginx-service-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:410px){.nginx-service-cards{grid-template-columns:minmax(0,1fr)}}
</style>
