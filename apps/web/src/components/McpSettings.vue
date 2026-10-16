<script setup>
import { onMounted, ref } from 'vue';
const props = defineProps({ csrf: { type: String, required: true } });
const policy = ref({ enabled: false, registrationEnabled: false, allowUpdates: false, allowDirectUpdates: false });
const grants = ref([]);
const installed = ref(null);
const error = ref('');
const message = ref('');
const busy = ref(false);

async function loadGrants() {
  const response = await fetch('/api/extensions/mcp/grants');
  if (response.ok) grants.value = (await response.json()).grants;
}
async function load() {
  error.value = '';
  try {
    const response = await fetch('/api/extensions/mcp/settings');
    if (response.status === 404) { installed.value = false; return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '无法加载 MCP 扩展');
    installed.value = true;
    policy.value = {
      enabled: result.policy.enabled,
      registrationEnabled: result.policy.registrationEnabled,
      allowUpdates: result.policy.allowUpdates,
      allowDirectUpdates: result.policy.allowDirectUpdates
    };
    await loadGrants();
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
    if (!response.ok) throw new Error(result.error || '无法保存 MCP 设置');
    policy.value = {
      enabled: result.policy.enabled,
      registrationEnabled: result.policy.registrationEnabled,
      allowUpdates: result.policy.allowUpdates,
      allowDirectUpdates: result.policy.allowDirectUpdates
    };
    message.value = 'MCP 设置已保存；已登录客户端的工具列表现在由全局策略决定';
  } catch (cause) { error.value = cause.message; }
  finally { busy.value = false; }
}
async function revoke(id) {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    const response = await fetch('/api/extensions/mcp/grants/' + encodeURIComponent(id), {
      method: 'DELETE', headers: { 'X-Panel-CSRF': props.csrf }
    });
    if (!response.ok) throw new Error((await response.json()).error || '断开客户端失败');
    await loadGrants();
    message.value = '客户端授权已撤销，其令牌立即失效';
  } catch (cause) { error.value = cause.message; }
  finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
  <section class="settings-section">
    <h3>MCP 扩展</h3>
    <p v-if="installed === false" class="muted">MCP 扩展尚未安装。</p>
    <template v-else-if="installed">
      <p class="muted small">MCP 仅向已登录、已授权的客户端开放。所有客户端共享面板全局允许的工具，不再逐客户端、逐 Action 管理权限。新加入的 MCP Action 在下次刷新工具列表时自动可用。</p>
      <label class="refresh-choice">
        <input type="checkbox" v-model="policy.enabled" /> 启用 MCP 端点
      </label>
      <label class="refresh-choice">
        <input type="checkbox" v-model="policy.registrationEnabled" :disabled="!policy.enabled"/>
        允许新 OAuth 客户端注册（连接成功后可关闭）
      </label>
      <label class="refresh-choice">
        <input type="checkbox" v-model="policy.allowUpdates" :disabled="!policy.enabled"/>
        允许 MCP 提交更新申请（需 Web 审批）
      </label>
      <label class="refresh-choice">
        <input type="checkbox" v-model="policy.allowDirectUpdates" :disabled="!policy.enabled"/>
        允许 MCP 直接执行受限面板更新（无需每次 Web 审批）
      </label>
      <p class="muted small">直接更新还需生产 Broker 已启用。开启后所有已登录 MCP 客户端，包括以前连接的客户端，都能使用直接更新工具；关闭后立即禁止。更新仍只接受受信任的 Git 提交，并经过 Broker 验证。</p>
      <p class="muted small">模块声明的读取工具和终端命令能力对已授权客户端自动可用，无需逐项勾选。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="message" class="notice success-notice" role="status">{{ message }}</p>
      <button class="form-button primary" :disabled="busy" type="button" @click="save">保存 MCP 设置</button>

      <h4>已连接客户端</h4>
      <p class="muted small">这里只管理连接，不再单独限制每个客户端的工具。撤销授权相当于断开该客户端，旧令牌会立即失效。</p>
      <div v-for="grant in grants" :key="grant.id" class="session-row">
        <div>
          <strong>{{ grant.clientName }}</strong>
          <div class="muted small">创建于 {{ grant.createdAt }} · {{ grant.revoked ? '已撤销' : '生效中' }}</div>
        </div>
        <button v-if="!grant.revoked" :disabled="busy" type="button" class="form-button"
          @click="revoke(grant.id)">撤销授权</button>
      </div>
      <p v-if="!grants.length" class="muted">还没有已连接的 MCP 客户端。</p>
    </template>
    <template v-else>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-else class="muted">正在读取 MCP 模块状态…</p>
      <button v-if="error" class="form-button" type="button" @click="load">重试</button>
    </template>
  </section>
</template>
