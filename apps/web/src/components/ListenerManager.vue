<script setup>
import { onMounted, ref } from 'vue';

const props=defineProps({csrf:{type:String,required:true}});
const emit=defineEmits(['unauthorized']);
const status=ref(null),host=ref('127.0.0.1'),port=ref(4188);
const password=ref(''),code=ref(''),busy=ref(false),error=ref(''),notice=ref('');
async function post(url,payload) {
  const r=await fetch(url,{method:'POST',
    headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
    body:JSON.stringify(payload)});
  if(r.status===401)emit('unauthorized');
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||('HTTP '+r.status));
  return data;
}
async function refresh() {
  const data=await post('/api/actions/panel.listener.status/execute',{input:{}});
  status.value=data.result;
  if(data.result.pending){
    host.value=data.result.pending.host;
    port.value=data.result.pending.port;
  }else{
    host.value=data.result.configured.host;
    port.value=data.result.configured.port;
  }
}
async function run(operation) {
  if(busy.value)return;
  busy.value=true;error.value='';notice.value='';
  try {
    if(operation==='request') {
      const result=await post('/api/actions/panel.listener.request/execute',
        {input:{host:host.value,port:Number(port.value)}});
      notice.value='申请 '+result.result.host+':'+result.result.port+' 已创建，等待密码确认。';
    } else if(operation==='approve') {
      await post('/api/panel/listener/approve',
        {id:status.value.pending.id,currentPassword:password.value,code:code.value});
      notice.value='配置已保存，但尚未切换。需要管理员显式重启 linux-panel.service 才生效。';
      password.value='';code.value='';
    } else if(operation==='cancel') {
      await post('/api/panel/listener/cancel',{id:status.value.pending.id});
      notice.value='监听变更申请已取消。';
    }
    await refresh();
  }catch(cause){error.value=cause.message;}
  finally{busy.value=false;}
}
onMounted(()=>{void refresh().catch(cause=>error.value=cause.message);});
</script>

<template>
  <section class="action-card" aria-label="HTTP 监听设置">
    <div class="card-heading">
      <div><div class="label">panel.listener.status / panel.listener.request</div><h3>HTTP 监听设置</h3></div>
      <span class="read-pill">变更需确认</span>
    </div>
    <p class="card-description">面板只管理自己的 HTTP 地址与端口，不安装或编辑任何反向代理。</p>
    <p v-if="status">当前运行：<code>{{ status.active.host }}:{{ status.active.port }}</code>；
      已保存：<code>{{ status.configured.host }}:{{ status.configured.port }}</code></p>
    <p v-if="status?.restartRequired" role="status">新配置等待手动重启面板生效。重启前确认可通过新地址访问，避免失去管理连接。</p>
    <p v-if="status">公开 Origin：<code>{{ status.publicOrigin }}</code></p>
    <div class="toolbar">
      <label>监听地址
        <select v-model="host" :disabled="busy || !!status?.pending">
          <option value="127.0.0.1">127.0.0.1（本机）</option>
          <option value="0.0.0.0">0.0.0.0（所有 IPv4 接口）</option>
        </select>
      </label>
      <label>端口
        <input v-model.number="port" type="number" min="1024" max="65535"
          :disabled="busy || !!status?.pending" />
      </label>
    </div>
    <p class="muted small">监听 0.0.0.0 会扩大 HTTP 暴露面；必须另行管理防火墙、外部 HTTPS 及可信反向代理。面板不会自动开放端口。</p>
    <div v-if="status?.pending">
      <p>待确认申请：{{ status.pending.host }}:{{ status.pending.port }}（有效期至 {{ status.pending.expiresAt }}）</p>
      <label>再次输入管理员密码 <input v-model="password" type="password" autocomplete="current-password" /></label>
      <label>若启用了 TOTP，输入验证码 <input v-model="code" type="text" autocomplete="one-time-code" /></label>
      <div class="toolbar">
        <button type="button" :disabled="busy || !password" @click="run('approve')">确认并保存（不自动重启）</button>
        <button type="button" :disabled="busy" @click="run('cancel')">取消申请</button>
      </div>
    </div>
    <div v-else class="toolbar">
      <button type="button" :disabled="busy || !status" @click="run('request')">申请修改监听配置</button>
    </div>
    <div class="toolbar"><button type="button" :disabled="busy" @click="run('refresh')">刷新状态</button></div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>
