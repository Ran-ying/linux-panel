<script setup>
import {ref,watch} from 'vue';
const props=defineProps({initialData:{type:Object,required:true},listAction:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true}});
const emit=defineEmits(['unauthorized']);
const data=ref(props.initialData),busy=ref(false),error=ref(''),notice=ref(''),selected=ref(''),modal=ref(null);
watch(()=>props.initialData,newData=>{data.value=newData;});
async function request(action,input={}){
  const response=await fetch('/api/actions/'+encodeURIComponent(action)+'/execute',{
    method:'POST',headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
    body:JSON.stringify({input})
  });
  if(response.status===401)emit('unauthorized');
  const body=await response.json();
  if(!response.ok)throw Error(body.error||'请求失败');
  return body.result;
}
async function refresh(){
  if(busy.value)return;busy.value=true;error.value='';
  try{data.value=await request(props.listAction);}catch(e){error.value=e.message;}
  finally{busy.value=false;}
}
function ask(name){if(busy.value)return;selected.value=name;modal.value?.showModal();}
function dismiss(){if(!busy.value)modal.value?.close();}
async function renew(){
  if(busy.value||!selected.value)return;
  busy.value=true;error.value='';notice.value='';
  try{
    const result=await request(props.operations.renew,{name:selected.value});
    notice.value=result.status;
    if(!result.ok){error.value=result.output||result.status;return;}
    modal.value?.close();
    data.value=await request(props.listAction);
  }catch(e){error.value=e.message;}finally{busy.value=false;}
}
const date=value=>value?new Date(value).toLocaleDateString('zh-CN'):'未知';
</script>

<template>
  <div class="certbot-manager">
    <div class="certbot-manager-heading">
      <div>
        <strong>自动续期证书</strong>
        <p class="muted small">{{ data.count }} 份续期配置 ·
          <span>{{ data.timerEnabled && data.timerActive?'自动续期已启用':'请检查 certbot.timer 状态' }}</span>
        </p>
      </div>
      <button type="button" :disabled="busy" @click="refresh">刷新数据</button>
    </div>
    <p v-if="!data.installed" role="alert">未检测到 Certbot。</p>
    <p v-else-if="!data.certificates.length" class="muted small">未发现 Certbot 续期配置。</p>
    <div v-else class="certbot-records">
      <article v-for="cert in data.certificates" :key="cert.name" class="certbot-record">
        <div class="certbot-record-title">
          <strong>{{ cert.name }}</strong>
          <button type="button" :disabled="busy" :aria-label="'续期证书 '+cert.name" @click="ask(cert.name)">检查并续期</button>
        </div>
        <p class="muted small">{{ cert.domains.join('、')||'未识别域名' }}</p>
        <div class="certbot-record-detail">
          <span>有效期至 {{ date(cert.validTo) }}</span>
          <span>剩余 {{ cert.status==='unknown'?'未知':cert.daysRemaining }} 天</span>
          <span>验证方式 {{ cert.authenticator }}</span>
        </div>
      </article>
    </div>
    <details v-if="data.warnings?.length">
      <summary>读取提示（{{ data.warnings.length }}）</summary>
      <p v-for="w in data.warnings" :key="w" class="muted small">{{ w }}</p>
    </details>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <dialog ref="modal" class="certbot-confirm" aria-label="确认 Certbot 续期" @close="selected=''">
      <h3>确认检查并续期</h3>
      <p>对 <strong>{{ selected }}</strong> 执行 Certbot 到期续期检查？</p>
      <p class="muted small">仅使用既有续期配置，不强制提前签发；成功后检查并重载运行中的 Nginx。</p>
      <div class="certbot-confirm-actions">
        <button type="button" :disabled="busy" @click="dismiss">取消</button>
        <button type="button" :disabled="busy" @click="renew">确认续期</button>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.certbot-manager{display:grid;gap:12px;min-width:0}
.certbot-manager-heading,.certbot-record-title{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.certbot-manager-heading p,.certbot-record p{margin:3px 0 0}
.certbot-records{display:grid;gap:12px}
.certbot-record{display:grid;gap:8px;border:1px solid var(--border-panel);border-radius:var(--ui-card-radius);padding:var(--ui-card-padding);min-width:0}
.certbot-record-detail{display:flex;gap:8px 18px;flex-wrap:wrap;font-size:.9rem}
.certbot-confirm{background:var(--panel-bg);color:var(--text-primary);border:1px solid var(--border-panel);border-radius:var(--ui-card-radius);padding:var(--ui-dialog-padding);width:min(94vw,36rem)}
.certbot-confirm::backdrop{background:var(--ui-dialog-backdrop)}
.certbot-confirm h3{margin:0 0 12px}
.certbot-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
</style>
