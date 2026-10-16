<script setup>
import { onMounted, ref, watch } from 'vue';
import McpSettings from './McpSettings.vue';

const props = defineProps({
  csrf: { type: String, required: true },
  user: { type: Object, required: true },
  modules: { type: Array, default: () => [] }
});
const emit = defineEmits(['signed-out', 'settings-changed', 'modules-changed']);
const orderedModules=ref(props.modules.filter(module=>module.id!=='panel'));
watch(()=>props.modules,modules=>{orderedModules.value=modules.filter(module=>module.id!=='panel');});
const settings = ref({ panelName: 'Linux Panel', language: 'zh-CN', theme: 'dark' });
const sessions = ref([]);
const sessionDays = ref(30);
const totpInfo=ref({enabled:false,recoveryCodesRemaining:0});
const totpSetup=ref(null);
const recoveryCodes=ref([]);
const totpPassword=ref('');
const totpCode=ref('');
const audit = ref([]);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const error = ref('');
const message = ref('');
const busy = ref(false);

async function request(url, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.method && options.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Panel-CSRF'] = props.csrf;
  }
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json();
  if (response.status === 401) emit('signed-out');
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function reload() {
  try {
    const [cfg, list, events, factors, policy] = await Promise.all([
      request('/api/panel/settings'),
      request('/api/auth/sessions'),
      request('/api/panel/audit'),
      request('/api/auth/totp'),
      request('/api/auth/session-policy')
    ]);
    settings.value = cfg.settings;
    sessions.value = list.sessions;
    sessionDays.value = policy.days;
    audit.value = events.events;
    totpInfo.value=factors;
    emit('settings-changed', cfg.settings);
  } catch (cause) { error.value = cause.message; }
}

async function execute(work, successMessage) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await work();
    message.value = successMessage;
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}

function saveSettings() {
  return execute(async () => {
    const result = await request('/api/panel/settings', {
      method: 'PUT',
      body: JSON.stringify(settings.value)
    });
    settings.value = result.settings;
    emit('settings-changed', result.settings);
  }, '面板设置已保存');
}

function moveModule(index,step) {
  const next=[...orderedModules.value];
  const to=index+step;
  if(to<0 || to>=next.length)return;
  [next[index],next[to]]=[next[to],next[index]];
  return execute(async()=>{
    const response=await request('/api/modules/order',{
      method:'PUT',body:JSON.stringify({order:next.map(module=>module.id)})
    });
    orderedModules.value=response.modules.filter(module=>module.id!=='panel');
    emit('modules-changed',response.modules);
  },'模块顺序已保存');
}

function changePassword() {
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致';
    return;
  }
  return execute(async () => {
    await request('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value })
    });
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    emit('signed-out');
  }, '密码已更新；请重新登录');
}

function saveSessionPolicy() {
  return execute(async () => {
    await request('/api/auth/session-policy', {
      method: 'PUT', body: JSON.stringify({ days: sessionDays.value })
    });
    await reload();
  }, '登录有效期已保存，当前设备的到期时间已更新');
}

function revokeSession(id, current) {
  return execute(async () => {
    await request('/api/auth/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
    if (current) emit('signed-out');
    else await reload();
  }, '会话已撤销');
}

async function startTotp(){
  return execute(async()=>{
    totpSetup.value=await request('/api/auth/totp/setup',{method:'POST',body:JSON.stringify({currentPassword:totpPassword.value})});
    totpPassword.value='';
  },'在认证器中添加密钥，并输入当前验证码确认');
}
async function enableTotp(){
  return execute(async()=>{
    const value=await request('/api/auth/totp/enable',{method:'POST',body:JSON.stringify({code:totpCode.value})});
    recoveryCodes.value=value.recoveryCodes;
    totpSetup.value=null;totpCode.value='';await reload();
  },'双因素认证已启用；请离线保存恢复码（只显示一次）');
}
async function disableTotp(){
  return execute(async()=>{
    await request('/api/auth/totp/disable',{method:'POST',body:JSON.stringify({currentPassword:totpPassword.value,code:totpCode.value})});
    totpPassword.value='';totpCode.value='';recoveryCodes.value=[];await reload();
  },'双因素认证已关闭');
}
onMounted(reload);
</script>

<template>
  <div class="module-content settings-page">
    <div class="module-intro">
      <h2>面板设置</h2>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status" class="notice success-notice">{{ message }}</p>

    <section class="settings-section">
      <h3>基本设置</h3>
      <form @submit.prevent="saveSettings">
        <label for="panel-name">面板名称</label>
        <input id="panel-name" v-model="settings.panelName" required maxlength="60" />
        <button class="primary form-button" :disabled="busy" type="submit">保存设置</button>
      </form>
    </section>

    <section class="settings-section">
      <h3>账户与安全</h3>
      <p>当前账号：<strong>{{ user.username }}</strong>（{{ user.role }}）</p>
      <form @submit.prevent="changePassword" class="settings-form">
        <label for="old-password">当前密码</label>
        <input id="old-password" type="password" v-model="currentPassword" required autocomplete="current-password"/>
        <label for="new-password">新密码（至少 12 字节）</label>
        <input id="new-password" type="password" v-model="newPassword" required minlength="12" autocomplete="new-password"/>
        <label for="confirm-password">确认新密码</label>
        <input id="confirm-password" type="password" v-model="confirmPassword" required minlength="12" autocomplete="new-password"/>
        <button type="submit" class="form-button" :disabled="busy">修改密码并退出所有会话</button>
      </form>
    </section>

    <section class="settings-section">
      <h3>双因素认证（TOTP）</h3>
      <p>当前状态：{{ totpInfo.enabled?'已启用':'未启用' }}；恢复码剩余 {{ totpInfo.recoveryCodesRemaining }} 个。</p>
      <label for="totp-password">当前密码</label>
      <input id="totp-password" v-model="totpPassword" type="password" autocomplete="current-password" />
      <template v-if="totpSetup">
        <p class="muted small">请在认证器中手动输入以下一次性密钥；确认后将不再显示：</p>
        <code>{{ totpSetup.secret }}</code>
      </template>
      <label for="totp-code">6 位验证码或一次性恢复码</label>
      <input id="totp-code" v-model.trim="totpCode" autocomplete="one-time-code" />
      <button v-if="!totpInfo.enabled && !totpSetup" type="button" :disabled="busy" @click="startTotp">验证密码并开始绑定</button>
      <button v-if="totpSetup" type="button" :disabled="busy" @click="enableTotp">确认并启用 TOTP</button>
      <button v-if="totpInfo.enabled" type="button" :disabled="busy" @click="disableTotp">验证密码和验证码后关闭</button>
      <div v-if="recoveryCodes.length" class="notice" role="status">
        <strong>一次性恢复码：请立即离线保存，离开后不会再次展示</strong>
        <div v-for="code in recoveryCodes" :key="code"><code>{{ code }}</code></div>
        <button type="button" @click="recoveryCodes=[]">我已保存，隐藏恢复码</button>
      </div>
    </section>
    <section class="settings-section">
      <div class="section-heading"><h3>登录会话</h3><button type="button" @click="reload">刷新</button></div>
      <form @submit.prevent="saveSessionPolicy" class="settings-form">
        <label for="session-days">登录有效期（天）</label>
        <input id="session-days" type="number" min="1" max="365" step="1" required v-model.number="sessionDays" />
        <p class="muted small">默认 30 天，可设置 1–365 天。保存后，当前设备从现在起重新计时，后续登录使用此有效期；其他已登录设备保持原到期时间。</p>
        <button type="submit" class="form-button" :disabled="busy">保存登录有效期</button>
      </form>
      <p v-if="!sessions.length" class="muted">没有有效会话</p>
      <div v-for="session in sessions" :key="session.id" class="session-row">
        <div>
          <strong>{{ session.current ? '当前设备' : '其他会话' }}</strong>
          <div class="muted small">创建于 {{ session.createdAt }} · 到期 {{ session.expiresAt }}</div>
        </div>
        <button type="button" :disabled="busy" @click="revokeSession(session.id, session.current)">撤销</button>
      </div>
    </section>

    <section class="settings-section">
      <h3>模块管理</h3>
      <p class="muted small">上下移动模块即可保存导航顺序；安装、卸载和启停功能尚未实现。</p>
      <div v-for="(module,index) in orderedModules" :key="module.id" class="module-summary module-order-item">
        <div class="module-order-label">
          <strong>{{ module.name }}</strong>
          <span class="muted small">{{ module.id }} · v{{ module.version }}</span>
        </div>
        <div class="module-order-controls">
          <button type="button" :aria-label="'上移 '+module.name"
            :disabled="busy || index===0" @click="moveModule(index,-1)">↑</button>
          <button type="button" :aria-label="'下移 '+module.name"
            :disabled="busy || index===orderedModules.length-1" @click="moveModule(index,1)">↓</button>
        </div>
      </div>
      <p v-if="!orderedModules.length" class="muted">尚未安装任何业务模块，面板设置仍然可用。</p>
    </section>

    <section class="settings-section">
      <h3>操作审计</h3>
      <div v-for="entry in audit.slice(0, 20)" :key="entry.id" class="audit-row">
        <span>{{ entry.event }}<span v-if="entry.detail"> · {{ entry.detail }}</span></span>
        <span class="muted small">{{ entry.at }}</span>
      </div>
      <p v-if="!audit.length" class="muted">暂无审计记录</p>
    </section>

    <McpSettings :csrf="csrf" />
  </div>
</template>
