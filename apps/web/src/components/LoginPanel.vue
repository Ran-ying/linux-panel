<script setup>
import { ref } from 'vue';

const props = defineProps({ initialized: { type: Boolean, required: true } });
const emit = defineEmits(['signed-in']);
const username = ref('admin');
const password = ref('');
const secondFactor=ref('');
const busy = ref(false);
const error = ref('');

async function signIn() {
  if (busy.value || !props.initialized) return;
  busy.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Panel-Client': 'web' },
      body: JSON.stringify({ username: username.value, password: password.value, secondFactor:secondFactor.value })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    password.value = '';
    secondFactor.value='';
    emit('signed-in', payload);
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-shell">
    <section class="auth-card">
      <div class="eyebrow">LINUX PANEL / V0.5</div>
      <h1>登录 Linux Panel</h1>
      <p v-if="!initialized" class="notice">
        尚未初始化管理员账号。请在服务器本地终端运行
        <code>npm run admin:init</code> 创建管理员后，刷新此页面。
        不提供网页公开注册或默认密码。
      </p>
      <form v-else @submit.prevent="signIn">
        <label for="login-user">用户名</label>
        <input id="login-user" v-model.trim="username" required minlength="3"
          autocomplete="username" spellcheck="false" />
        <label for="login-pass">密码</label>
        <input id="login-pass" v-model="password" type="password" required
          autocomplete="current-password" />
        <label for="login-otp">双因素验证码 / 恢复码（未开启可留空）</label>
        <input id="login-otp" v-model.trim="secondFactor" inputmode="text" autocomplete="one-time-code"/>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <button type="submit" class="primary form-button" :disabled="busy">
          {{ busy ? '验证中…' : '登录' }}
        </button>
      </form>
      <p class="muted small">会话只存放在受 HttpOnly 保护的 Cookie 中；不提供默认密码；如已启用双因素认证，登录时必须提供动态验证码或一次性恢复码。</p>
    </section>
  </div>
</template>
