<script setup>
import {ref,onMounted,onUnmounted} from 'vue';
const props=defineProps({
  siteName:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true}
});
const emit=defineEmits(['unauthorized']);
const data=ref({name:props.siteName,pairs:[],warnings:[]});
const busy=ref(false),error=ref(''),loading=ref(true),privateValues=ref({}),privateBusy=ref(null);
let controller=null,alive=true;
onMounted(async()=>{await refresh();});
onUnmounted(()=>{
  alive=false;
  controller?.abort();
  privateValues.value={};
});
async function request(action,input,signal){
  const reply=await fetch('/api/actions/'+encodeURIComponent(action)+'/execute',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
    cache:'no-store',
    body:JSON.stringify({input}),
    ...(signal?{signal}:{})
  });
  if(reply.status===401)emit('unauthorized');
  const payload=await reply.json();
  if(!reply.ok)throw Error(payload.error||'HTTP '+reply.status);
  return payload.result;
}
async function refresh(){
  if(busy.value)return;
  busy.value=true;loading.value=true;error.value='';
  privateValues.value={};
  controller?.abort();controller=new AbortController();
  try{
    const value=await request(props.operations.certificates,{name:props.siteName},controller.signal);
    if(alive)data.value=value;
  }catch(e){if(alive&&e.name!=='AbortError')error.value=e.message;}
  finally{if(alive){busy.value=false;loading.value=false;}}
}
async function togglePrivate(index){
  if(privateValues.value[index]){const next={...privateValues.value};delete next[index];privateValues.value=next;return;}
  if(privateBusy.value!==null)return;
  privateBusy.value=index;error.value='';
  try{
    // A second authenticated, CSRF-protected Web-only request is made only
    // after explicit interaction; the root read never appears in list/MCP.
    const result=await request(props.operations.renew,{name:props.siteName,index});
    if(alive)privateValues.value={...privateValues.value,[index]:result.privatePem};
  }catch(e){if(alive)error.value=e.message;}
  finally{if(alive)privateBusy.value=null;}
}
</script>

<template>
  <div class="nginx-certificates" role="region" :aria-label="'SSL 证书管理：'+siteName">
    <div class="nginx-certs-toolbar">
      <h4>SSL 证书管理</h4>
      <button type="button" :disabled="busy" @click="refresh">刷新证书</button>
    </div>
    <p v-if="loading" class="muted small">正在读取 Nginx 配置中引用的证书…</p>
    <p v-else-if="!data.pairs.length" class="muted small">当前站点文件未直接声明 SSL 证书路径。</p>
    <div v-for="(pair,index) in data.pairs" :key="index" class="nginx-tls-pair">
      <div class="nginx-tls-columns">
        <div class="nginx-tls-column">
          <div class="nginx-tls-column-heading"><strong>公钥 / 公有证书</strong></div>
          <p class="nginx-tls-path">{{ pair.certificatePath }}</p>
          <pre v-if="pair.publicPem" class="nginx-tls-pem">{{ pair.publicPem }}</pre>
          <p v-else class="muted small">{{ pair.status }}</p>
        </div>
        <div class="nginx-tls-column nginx-tls-private">
          <div class="nginx-tls-column-heading">
            <strong>私钥</strong>
            <button type="button" :disabled="!pair.privateKeyConfigured||privateBusy!==null"
              :aria-label="(privateValues[index]?'隐藏':'显示')+'私钥 '+(index+1)"
              @click="togglePrivate(index)">
              {{ privateValues[index]?'隐藏私钥':privateBusy===index?'正在读取…':'显示私钥' }}
            </button>
          </div>
          <p class="nginx-tls-path">{{ pair.privateKeyPath||'没有配置私钥路径' }}</p>
          <pre v-if="privateValues[index]" class="nginx-tls-pem nginx-tls-secret">{{ privateValues[index] }}</pre>
          <p v-else class="nginx-tls-redacted">私钥已隐藏。仅在明确点击后临时显示，不自动加载。</p>
        </div>
      </div>
    </div>
    <details v-if="data.warnings?.length">
      <summary>读取提示（{{ data.warnings.length }}）</summary>
      <p v-for="(warning,i) in data.warnings" :key="i" class="muted small">{{ warning }}</p>
    </details>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.nginx-certificates{display:grid;gap:12px;min-width:0;border:0;border-radius:0;
  background:transparent;box-shadow:none;padding:0;margin:0}
.nginx-certs-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.nginx-certs-toolbar h4{margin:0;font-size:1rem}
.nginx-tls-pair+.nginx-tls-pair{border-top:1px solid var(--border-rule);padding-top:12px}
.nginx-tls-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;min-width:0}
.nginx-tls-column{min-width:0;overflow:hidden;border:0;border-radius:0;background:transparent;padding:0 8px 0 0}
.nginx-tls-column.nginx-tls-private{border-left:1px solid var(--border-rule);padding:0 0 0 8px}
.nginx-tls-column-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.nginx-tls-path{font-size:.76rem;overflow-wrap:anywhere;color:var(--text-muted);margin:4px 0 10px}
.nginx-tls-pem{margin:0;max-width:100%;max-height:24rem;overflow:auto;white-space:pre;
  font-family:ui-monospace,SFMono-Regular,monospace;font-size:.75rem;
  color:var(--text-primary);background:var(--input-bg);border:0;border-radius:0;padding:8px}
.nginx-tls-secret{user-select:text}
.nginx-tls-redacted{color:var(--text-muted);font-size:.83rem}
</style>
