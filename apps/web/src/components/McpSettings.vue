<script setup>
import { onMounted, ref } from 'vue';
const props = defineProps({ csrf: { type: String, required: true } });
const policy = ref({ enabled: false, registrationEnabled: false, allowUpdates:false, tools: {} });
const tools = ref([]);
const grants = ref([]);
const installed = ref(null);
const error = ref('');
const message = ref('');
const busy = ref(false);

async function loadGrants() {
  const response = await fetch('/api/extensions/mcp/grants');
  if (!response.ok) return;
  grants.value = (await response.json()).grants;
}
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
    if (!response.ok) throw new Error(result.error || 'Unable to save MCP settings');
    policy.value = result.policy;
    message.value = 'MCP 权限策略已保存';
  } catch (cause) { error.value = cause.message; }
  finally { busy.value = false; }
}
async function revoke(id) {
  if (busy.value) return;
  busy.value=true;error.value='';message.value='';
  try {
    const response=await fetch('/api/extensions/mcp/grants/'+encodeURIComponent(id),{
      method:'DELETE', headers:{'X-Panel-CSRF':props.csrf}
    });
    if (!response.ok) throw new Error((await response.json()).error || 'Failed to revoke');
    await loadGrants();
    message.value='授权已撤销，相关令牌立即失效';
  } catch(cause) { error.value=cause.message; }
  finally {busy.value=false;}
}
async function restrict(grant,scope) {
  if (busy.value) return;
  const reduced=grant.scopes.filter(s=>s!==scope);
  if (!reduced.length) {await revoke(grant.id);return;}
  busy.value=true;error.value='';message.value='';
  try {
    const response=await fetch('/api/extensions/mcp/grants/'+encodeURIComponent(grant.id),{
      method:'PUT',headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
      body:JSON.stringify({scopes:reduced})
    });
    if (!response.ok) throw new Error((await response.json()).error || 'Failed to limit scope');
    await loadGrants();
    message.value='客户端权限已收窄';
  } catch(cause) {error.value=cause.message;}
  finally {busy.value=false;}
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
      <label class="refresh-choice">
        <input type="checkbox" v-model="policy.registrationEnabled" :disabled="!policy.enabled"/>
        允许新 OAuth 客户端注册（连接成功后建议关闭）
      </label>
      <label class="refresh-choice">
        <input type="checkbox" v-model="policy.allowUpdates"/>
        允许 MCP 提交更新申请（Web 更新不依赖此开关；审批在「面板维护」中进行）
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
      <h4>已授权客户端</h4>
      <p class="muted small">这些权限是客户端自己的授权范围；上面的 Action 开关是全局暴露白名单，两者取交集。</p>
      <div v-for="grant in grants" :key="grant.id" class="session-row">
        <div>
          <strong>{{ grant.clientName }}</strong>
          <div class="muted small">{{ grant.clientId }}</div>
          <div class="muted small">创建于 {{ grant.createdAt }} · {{ grant.revoked ? '已撤销' : '生效中' }}</div>
          <div v-if="!grant.revoked" class="toolbar">
            <button v-for="scope in grant.scopes" :key="scope" :disabled="busy" type="button"
              @click="restrict(grant,scope)" :title="'撤销 '+scope+' 权限'">
              {{ scope }} ×
            </button>
          </div>
          <div v-else class="muted small">无法使用旧 Token 或刷新令牌</div>
        </div>
        <button v-if="!grant.revoked" :disabled="busy" type="button" class="form-button"
          @click="revoke(grant.id)">撤销授权</button>
      </div>
      <p v-if="!grants.length" class="muted">还没有已授权的 MCP 客户端。</p>
    </template>
    <template v-else>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-else class="muted">正在读取 MCP 模块状态…</p>
      <button v-if="error" class="form-button" type="button" @click="load">重试</button>
    </template>
  </section>
</template>
