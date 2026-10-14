<script setup>
import { onMounted, ref } from 'vue';
const props = defineProps({ csrf: { type: String, required: true } });
const policy = ref({ enabled: false, tools: {} });
const tools = ref([]);
const installed = ref(null);
const error = ref('');
const message = ref('');
const busy = ref(false);

async function load() {
  error.value = '';
  try {
    const response = await fetch('/api/extensions/mcp/settings');
    if (response.status === 404) { installed.value = false; return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to load MCP extension');
    installed.value = true;
    policy.value = result.policy;
    tools.value = result.tools;
  } catch (cause) { error.value = cause.message; }
}
async function save() {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    const response = await fetch('/api/extensions/mcp/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Panel-CSRF': props.csrf },
      body: JSON.stringify(policy.value)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to save MCP settings');
    policy.value = result.policy;
    message.value = 'MCP 权限策略已保存';
  } catch (cause) { error.value = cause.message; }
  finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
  <section class="settings-section">
    <h3>MCP 扩展 · 工具权限</h3>
    <p v-if="installed === false" class="muted">MCP 扩展尚未安装。</p>
    <template v-else-if="installed">
      <p class="muted small">MCP 是独立传输扩展，共用面板 Auth 身份。启用开关不等于允许匿名访问；没有 OAuth 授权时，/mcp 仍会拒绝请求。</p>
      <label class="refresh-choice">
        <input type="checkbox" v-model="policy.enabled" /> 启用 MCP 端点
      </label>
      <h4>允许暴露的只读 Action</h4>
      <div v-for="tool in tools" :key="tool.id" class="session-row">
        <div>
          <strong>{{ tool.title }}</strong>
          <div class="muted small">{{ tool.id }} · {{ tool.permission }}</div>
        </div>
        <input type="checkbox" v-model="policy.tools[tool.id]" :aria-label="'允许 '+tool.id" />
      </div>
      <p v-if="!tools.length" class="muted">没有业务模块提供 MCP 只读工具。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="message" class="notice success-notice" role="status">{{ message }}</p>
      <button class="form-button primary" :disabled="busy" type="button" @click="save">保存 MCP 策略</button>
      <p class="muted small">客户端授权、撤销及 OAuth 将在 v0.4 的后续阶段接入。</p>
    </template>
    <p v-else class="muted">正在读取 MCP 模块状态…</p>
  </section>
</template>
