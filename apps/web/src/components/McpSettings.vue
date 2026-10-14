<script setup>
import { onMounted, ref } from 'vue';
const props = defineProps({ csrf: { type: String, required: true } });
const policy = ref({ enabled: false, registrationEnabled: false, allowUpdates:false, tools: {} });
const tools = ref([]);
const grants = ref([]);
const installed = ref(null);
const update=ref(null);
const updateSha=ref('');
const totpRequired=ref(false);
const approvePassword=ref('');
const approveCode=ref('');
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
    await loadUpdate();
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
async function loadUpdate(){
  // The current user's TOTP status controls *presentation*, never server
  // authorization. A stale UI cannot bypass the backend step-up check.
  const factorResponse=await fetch('/api/auth/totp');
  totpRequired.value=factorResponse.ok && (await factorResponse.json()).enabled===true;
  const response=await fetch('/api/extensions/mcp/update');
  if(response.ok)update.value=await response.json();
  else update.value=null;
}
async function requestPanelUpdate(){
  if(busy.value)return;
  busy.value=true;error.value='';message.value='';
  try{
    // Web and MCP share the same registered Action and ActionEngine.
    const input=updateSha.value?{targetSha:updateSha.value.trim()}:{};
    const response=await fetch('/api/actions/panel.update.request/execute',{
      method:'POST',headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
      body:JSON.stringify({input})
    });
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||'无法申请更新');
    message.value=payload.result.status==='up_to_date'
      ?'当前面板已经处于最新提交'
      :'已生成更新申请；检查 Git 提交后在下面确认';
    updateSha.value='';
    await loadUpdate();
  }catch(cause){error.value=cause.message;}
  finally{busy.value=false;}
}
async function approveUpdate(){
  if(!update.value?.pending || busy.value)return;
  busy.value=true;error.value='';message.value='';
  try{
    const response=await fetch('/api/extensions/mcp/update/approve',{
      method:'POST',headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
      body:JSON.stringify({id:update.value.pending.id,currentPassword:approvePassword.value,code:approveCode.value})
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Failed to approve');
    approvePassword.value='';approveCode.value='';
    message.value='更新已提交至独立执行器；连接可能会短暂中断。';
    await loadUpdate();
  }catch(cause){error.value=cause.message;}
  finally{busy.value=false;}
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
        允许 MCP 申请面板更新（需要独立 OAuth Scope、Web 确认和密码复核；TOTP 可选）
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
      <h4>面板更新 · Action</h4>
      <p class="muted small">Web 调用与 MCP 共用 <code>panel.update.request</code>，仅创建申请，不执行部署。可填写可信 main 的完整 SHA；公共仓库可留空由服务端查询。</p>
      <label>目标完整 Git SHA（可选）<input type="text" v-model.trim="updateSha" placeholder="40 位十六进制提交 SHA" autocomplete="off"/></label>
      <button type="button" :disabled="busy" @click="requestPanelUpdate">通过 Action 申请更新</button>
      <button type="button" :disabled="busy" @click="loadUpdate">刷新更新状态</button>
      <template v-if="update?.pending">
        <p>待处理更新：<code>{{ update.pending.from }}</code> → <code>{{ update.pending.target }}</code></p>
        <p class="muted small">申请 ID：{{ update.pending.id }}；过期时间：{{ update.pending.expiresAt }}</p>
        <template v-if="!update.pending.approved">
          <label>管理员当前密码<input type="password" v-model="approvePassword" autocomplete="current-password"/></label>
          <label v-if="totpRequired">新的 TOTP 六位码<input type="text" v-model.trim="approveCode" autocomplete="one-time-code"/></label>
          <p v-else class="muted small">当前没有启用 TOTP；确认更新只需要重新验证管理员密码。</p>
          <button type="button" :disabled="busy" @click="approveUpdate">确认部署以上准确提交</button>
        </template>
        <p v-else>已确认，等待独立更新器执行。</p>
      </template>
      <p v-if="update?.lastResult">上次执行：{{ update.lastResult.status }} · {{ update.lastResult.sha.slice(0,12) }}</p>
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
