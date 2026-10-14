<script setup>
import { onMounted, ref } from 'vue';

const props = defineProps({
  csrf: { type: String, required: true },
  user: { type: Object, required: true },
  modules: { type: Array, default: () => [] }
});
const emit = defineEmits(['signed-out', 'settings-changed']);
const settings = ref({ panelName: 'Linux Panel', language: 'zh-CN', theme: 'dark' });
const sessions = ref([]);
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
    const [cfg, list, events] = await Promise.all([
      request('/api/panel/settings'),
      request('/api/auth/sessions'),
      request('/api/panel/audit')
    ]);
    settings.value = cfg.settings;
    sessions.value = list.sessions;
    audit.value = events.events;
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

function revokeSession(id, current) {
  return execute(async () => {
    await request('/api/auth/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
    if (current) emit('signed-out');
    else await reload();
  }, '会话已撤销');
}

onMounted(reload);
</script>

<template>
  <div class="module-content settings-page">
    <div class="module-intro">
      <div class="label">内置功能 / 无需业务模块</div>
      <h2>面板设置</h2>
      <p>配置面板与账号安全。即使所有业务模块都已卸载，此页面仍可使用。</p>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status" class="notice success-notice">{{ message }}</p>

    <section class="settings-section">
      <h3>基本设置</h3>
      <form @submit.prevent="saveSettings">
        <label for="panel-name">面板名称</label>
        <input id="panel-name" v-model="settings.panelName" required maxlength="60" />
        <p class="muted small">当前语言和主题设置已保存在后端；完整多语言和外观切换留待后续 Web UI 阶段。</p>
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
      <div class="section-heading"><h3>登录会话</h3><button type="button" @click="reload">刷新</button></div>
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
      <p class="muted small">当前为只读模块清单；安装、卸载和启停权限尚未实现。</p>
      <div v-for="module in modules" :key="module.id" class="module-summary">
        <strong>{{ module.name }}</strong>
        <span class="muted small">{{ module.id }} · v{{ module.version }}</span>
      </div>
      <p v-if="!modules.length" class="muted">尚未安装任何业务模块，面板设置仍然可用。</p>
    </section>

    <section class="settings-section">
      <h3>操作审计</h3>
      <div v-for="entry in audit.slice(0, 20)" :key="entry.id" class="audit-row">
        <span>{{ entry.event }}<span v-if="entry.detail"> · {{ entry.detail }}</span></span>
        <span class="muted small">{{ entry.at }}</span>
      </div>
      <p v-if="!audit.length" class="muted">暂无审计记录</p>
    </section>

    <section class="settings-section">
      <h3>MCP 扩展</h3>
      <p class="muted">MCP 扩展与 OAuth 授权将在 v0.4 实现；当前没有对外开放 MCP 接口。</p>
    </section>
  </div>
</template>
