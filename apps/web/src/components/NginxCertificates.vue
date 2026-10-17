<script setup>
import {ref,onMounted,onUnmounted} from 'vue';
const props=defineProps({
  siteName:{type:String,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true}
});
const emit=defineEmits(['unauthorized']);
const data=ref({name:props.siteName,pairs:[],warnings:[]});
const drafts=ref({});
const busy=ref(false),loading=ref(true),error=ref(''),notice=ref('');
let controller=null,alive=true,generation=0;
onMounted(()=>{void refresh();});
onUnmounted(()=>{
  alive=false;generation++;
  controller?.abort();
  // Remove both the displayed key and any unsaved secret draft on page exit.
  drafts.value={};
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
  busy.value=true;loading.value=true;error.value='';notice.value='';
  const current=++generation;
  controller?.abort();controller=new AbortController();
  drafts.value={};
  try{
    const value=await request(props.operations.certificates,{name:props.siteName},controller.signal);
    if(!alive||current!==generation)return;
    data.value=value;
    const initial={};
    for(let i=0;i<value.pairs.length;i++){
      initial[i]={certificatePem:value.pairs[i].certificatePem,privatePem:'',
        originalPrivate:'',keyLoaded:false,keyError:'',saving:false};
    }
    drafts.value=initial;
    // The user explicitly requested the configured private key to be displayed
    // normally beside the certificate, rather than behind a Reveal control.
    // Each secret is fetched by a separate Web-only root Action, never through
    // the normal TLS certificate listing, MCP or the panel audit log.
    await Promise.all(value.pairs.map(async(pair,index)=>{
      if(!pair.privateKeyConfigured||!pair.revision)return;
      try{
        const result=await request(props.operations.renew,{name:props.siteName,index},controller.signal);
        if(!alive||current!==generation)return;
        drafts.value[index]={...drafts.value[index],privatePem:result.privatePem,
          originalPrivate:result.privatePem,keyLoaded:true};
      }catch(cause){
        if(!alive||current!==generation||cause.name==='AbortError')return;
        drafts.value[index]={...drafts.value[index],keyError:'无法读取当前私钥：'+cause.message};
      }
    }));
  }catch(cause){
    if(alive&&current===generation&&cause.name!=='AbortError')error.value=cause.message;
  }finally{
    if(alive&&current===generation){busy.value=false;loading.value=false;}
  }
}
async function save(index,side){
  const pair=data.value.pairs[index],draft=drafts.value[index];
  if(busy.value||!pair||!draft?.keyLoaded)return;
  const updateCertificate=draft.certificatePem!==pair.certificatePem;
  const updatePrivateKey=draft.privatePem!==draft.originalPrivate;
  if(!updateCertificate&&!updatePrivateKey){
    notice.value='内容没有变化';return;
  }
  busy.value=true;error.value='';notice.value='';
  drafts.value[index]={...draft,saving:true};
  try{
    const result=await request(props.operations.saveTls,{
      name:props.siteName,index,revision:pair.revision,
      certificatePem:draft.certificatePem,privatePem:draft.privatePem,
      updateCertificate,updatePrivateKey
    });
    if(!result.ok)throw Error(result.status||'保存失败');
    // Reload both editors after a successful transaction so their CAS versions
    // are current; never leave stale secret content in a detached draft.
    busy.value=false;
    await refresh();
    if(alive)notice.value=result.status;
  }catch(cause){if(alive)error.value='保存'+(side==='certificate'?'证书':'私钥')+'失败：'+cause.message;}
  finally{
    if(alive){busy.value=false;if(drafts.value[index])drafts.value[index].saving=false;}
  }
}
</script>

<template>
  <div class="nginx-certificates" role="region" :aria-label="'SSL 证书管理：'+siteName">
    <div class="nginx-certs-toolbar">
      <h4>SSL 证书管理</h4>
      <button type="button" :disabled="busy" @click="refresh">刷新证书</button>
    </div>
    <p v-if="loading" class="muted small" role="status">正在读取 Nginx 证书及私钥…</p>
    <p v-else-if="!data.pairs.length" class="muted small">当前站点文件未直接声明 SSL 证书路径。</p>
    <div v-for="(pair,index) in data.pairs" :key="index" class="nginx-tls-pair">
      <div class="nginx-tls-columns">
        <div class="nginx-tls-column">
          <p class="nginx-tls-path">{{ pair.certificatePath }}</p>
          <textarea v-if="drafts[index]" v-model="drafts[index].certificatePem"
            class="nginx-tls-editor" :aria-label="'CERTIFICATE '+(index+1)"
            spellcheck="false" autocapitalize="off" autocomplete="off"
            :disabled="busy||!drafts[index].keyLoaded||!pair.revision"
            rows="13" />
          <p v-else class="muted small">{{ pair.status }}</p>
          <button type="button" class="nginx-tls-save"
            :disabled="busy||!drafts[index]?.keyLoaded||!pair.revision"
            @click="save(index,'certificate')">保存</button>
        </div>
        <div class="nginx-tls-column nginx-tls-private">
          <p class="nginx-tls-path">{{ pair.privateKeyPath||'没有配置私钥路径' }}</p>
          <textarea v-if="drafts[index]" v-model="drafts[index].privatePem"
            class="nginx-tls-editor" :aria-label="'PRIVATE KEY '+(index+1)"
            spellcheck="false" autocapitalize="off" autocomplete="off"
            :placeholder="drafts[index].keyError||'正在读取私钥…'"
            :disabled="busy||!drafts[index].keyLoaded"
            rows="13" />
          <p v-if="drafts[index]?.keyError" class="error small" role="alert">{{ drafts[index].keyError }}</p>
          <button type="button" class="nginx-tls-save"
            :disabled="busy||!drafts[index]?.keyLoaded||!pair.revision"
            @click="save(index,'privateKey')">保存</button>
        </div>
      </div>
    </div>
    <p class="nginx-tls-caution muted small">保存前会校验证书与私钥是否匹配；若同时修改两侧，点击任一保存会一并提交。
      Certbot 管理的证书可能在下一次自动续期时被替换。</p>
    <details v-if="data.warnings?.length">
      <summary>读取提示（{{ data.warnings.length }}）</summary>
      <p v-for="(warning,i) in data.warnings" :key="i" class="muted small">{{ warning }}</p>
    </details>
    <p v-if="notice" role="status">{{ notice }}</p>
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
.nginx-tls-column{display:flex;flex-direction:column;align-items:stretch;gap:8px;
  min-width:0;overflow:hidden;border:0;border-radius:0;background:transparent;padding:0}
.nginx-tls-column.nginx-tls-private{border-left:1px solid var(--border-rule);padding:0}
.nginx-tls-path{font-size:.76rem;overflow-wrap:anywhere;color:var(--text-muted);margin:0;min-height:2.3em}
.nginx-tls-editor{box-sizing:border-box;display:block;width:100%;min-width:0;
  min-height:14rem;max-height:44rem;resize:vertical;overflow:auto;
  border:1px solid var(--input-border);border-radius:var(--ui-input-radius);
  padding:8px;background:var(--input-bg);color:var(--text-primary);
  font:inherit;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
  font-size:.75rem;line-height:1.5;white-space:pre;tab-size:2}
.nginx-tls-save{align-self:flex-end}
.nginx-tls-caution{margin:0}
</style>
