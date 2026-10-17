<script setup>
import {computed,ref,onMounted} from 'vue';
import {matchingCertificates} from '../nginx-certificates.js';
const props=defineProps({
  siteName:{type:String,required:true},siteDomains:{type:Array,required:true},
  operations:{type:Object,required:true},csrf:{type:String,required:true}
});
const emit=defineEmits(['unauthorized']);
const data=ref({provider:'Certbot / Let’s Encrypt',installed:true,count:0,certificates:[],warnings:[]});
const loading=ref(true),busy=ref(false),error=ref(''),notice=ref(''),detail=ref('');
const confirmation=ref(null),selected=ref('');
const matched=computed(()=>matchingCertificates(data.value.certificates,props.siteDomains));
const countText=computed(()=>matched.value.length+' 张域名匹配的证书');
onMounted(async()=>{try{await refresh();}catch(e){error.value=e.message||'读取证书失败';}
  finally{loading.value=false;}});
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
async function work(callback){
  if(busy.value)return;
  busy.value=true;error.value='';notice.value='';
  try{await callback();}catch(e){error.value=e.message||'操作失败';}
  finally{busy.value=false;}
}
async function refresh(){
  data.value=await request(props.operations.certificates);
}
function ask(name){
  if(busy.value||!matched.value.some(cert=>cert.name===name))return;
  selected.value=name;detail.value='';
  confirmation.value?.showModal();
}
function dismiss(){if(!busy.value)confirmation.value?.close();}
function renew(){return work(async()=>{
  const result=await request(props.operations.renew,{name:selected.value});
  detail.value=result.output;
  notice.value=result.status;
  if(!result.ok){error.value=result.status;return;}
  confirmation.value?.close();
  await refresh();
  notice.value=result.status;
});}
const shortDate=date=>date?new Date(date).toLocaleDateString('zh-CN'):'—';
const condition=cert=>cert.status==='expired'?'已过期':cert.status==='expiring'?'即将到期':'有效';
</script>

<template>
  <section class="nginx-certificates" :aria-label="'SSL 证书管理：'+siteName">
    <h4 class="nginx-cert-section-title">SSL 证书管理</h4>
    <div class="nginx-certs-toolbar">
      <p class="muted small">{{ data.provider }} · {{ loading?'正在读取证书…':countText }}</p>
      <button type="button" :disabled="busy" @click="work(refresh)">刷新证书</button>
    </div>
    <p v-if="!loading && !data.installed" class="muted small">未检测到 Certbot。</p>
    <p v-else-if="!loading && !matched.length" class="muted small">没有发现域名匹配的 Certbot 证书。此列表不代表网站是否启用了 HTTPS。</p>
    <p v-if="!loading && matched.length" class="muted small">以下证书按网站域名与证书 SAN 匹配，并不证明 Nginx 正在引用该证书。</p>
    <div v-if="!loading && matched.length" class="nginx-cert-list">
      <article v-for="cert in matched" :key="cert.name" class="nginx-cert-card">
        <div class="nginx-cert-heading">
          <strong>{{ cert.name }}</strong>
          <span>{{ condition(cert) }} · {{ cert.daysRemaining }} 天</span>
        </div>
        <div class="nginx-cert-domains">
          <span v-for="domain in cert.domains" :key="domain">{{ domain }}</span>
        </div>
        <div class="nginx-cert-metadata">
          <span>到期：{{ shortDate(cert.validTo) }}</span>
          <span>签发：{{ shortDate(cert.validFrom) }}</span>
          <span>颁发者：{{ cert.issuer }}</span>
          <span>公有证书：<code>{{ cert.certificatePath }}</code></span>
        </div>
        <div class="nginx-cert-actions">
          <button type="button" :disabled="busy" :aria-label="'续期证书 '+cert.name"
            @click="ask(cert.name)">检查并续期</button>
        </div>
      </article>
    </div>
    <details v-if="data.warnings?.length">
      <summary>读取提示（{{ data.warnings.length }}）</summary>
      <p v-for="(warning,i) in data.warnings" :key="i" class="muted small">{{ warning }}</p>
    </details>
    <p v-if="busy" role="status" class="muted small">正在处理…</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <details v-if="detail">
      <summary>查看 Certbot 输出</summary>
      <pre>{{ detail }}</pre>
    </details>
    <dialog ref="confirmation" class="nginx-certificate-dialog" aria-labelledby="nginx-renew-title"
      @close="selected=''">
      <div class="nginx-renew-form">
        <h3 id="nginx-renew-title">确认 SSL 证书续期</h3>
        <p>对 <strong>{{ selected }}</strong> 执行 Certbot 到期续期检查？</p>
        <p class="muted small">仅使用现有 Certbot 续期配置；不强制提前签发、不创建新证书。若续期命令成功，将检查并在运行中重载 Nginx。续期可能访问证书颁发机构。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="nginx-renew-actions">
          <button type="button" :disabled="busy" @click="dismiss">取消</button>
          <button type="button" :disabled="busy" @click="renew">确认续期</button>
        </div>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.nginx-certificates{display:grid;gap:12px;min-width:0}
.nginx-cert-section-title{margin:0;font-size:1rem;font-weight:600}
.nginx-certs-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.nginx-certs-toolbar p{margin:0}
.nginx-certs-toolbar button,.nginx-cert-actions button,.nginx-renew-actions button{
  font:inherit;min-height:2.35rem;padding:.35rem .8rem}
.nginx-cert-list{display:grid;gap:12px}
/* The selected site's SSL detail is already inside one rounded outer card.
   Certificates are plain sections, not additional nested background cards. */
.nginx-cert-card{border:0;border-radius:0;background:transparent;
  padding:0;display:grid;gap:10px;min-width:0}
.nginx-cert-card+.nginx-cert-card{border-top:1px solid var(--border-rule);padding-top:12px}
.nginx-cert-heading{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap}
.nginx-cert-domains{display:flex;flex-wrap:wrap;gap:6px}
.nginx-cert-domains span{padding:3px 8px;border-radius:8px;border:1px solid var(--border-rule);
  font-size:.85rem;overflow-wrap:anywhere}
.nginx-cert-metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 12px;
  color:var(--text-muted);font-size:.85rem;min-width:0}
.nginx-cert-metadata span{min-width:0;overflow-wrap:anywhere}
.nginx-cert-actions,.nginx-renew-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.nginx-certificates pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:20rem;overflow:auto}
.nginx-certificate-dialog{background:var(--panel-bg);color:var(--text-primary);
  border:1px solid var(--border-panel);border-radius:12px;padding:18px;width:min(94vw,38rem)}
.nginx-certificate-dialog::backdrop{background:#0008}
.nginx-renew-form{display:grid;gap:12px}
.nginx-renew-form h3,.nginx-renew-form p{margin:0}
@media(max-width:730px){.nginx-cert-metadata{grid-template-columns:minmax(0,1fr)}}
</style>
