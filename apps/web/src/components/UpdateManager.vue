<script setup>
import { onMounted, ref } from 'vue';

const props=defineProps({csrf:{type:String,required:true}});
const emit=defineEmits(['unauthorized']);
const update=ref(null);
const inspection=ref(null);
const sha=ref('');
const password=ref('');
const code=ref('');
const totpRequired=ref(false);
const exactConfirmed=ref(false);
const busy=ref(false);
const checking=ref(false);
const enabled=ref(true);
const error=ref('');
const message=ref('');

async function call(url,body) {
  const response=await fetch(url,{method:'POST',
    headers:{'Content-Type':'application/json','X-Panel-CSRF':props.csrf},
    body:JSON.stringify(body)});
  const payload=await response.json();
  if(response.status===401)emit('unauthorized');
  if(!response.ok)throw Object.assign(new Error(payload.error||'HTTP '+response.status),{status:response.status});
  return payload;
}
async function refresh(){
  if(checking.value)return;
  checking.value=true;error.value='';
  try {
    const payload=await call('/api/actions/panel.update.status/execute',{input:{}});
    update.value=payload.result;
    enabled.value=payload.result.brokerEnabled===true;
    const factor=await fetch('/api/auth/totp');
    if(factor.status===401)emit('unauthorized');
    if(factor.ok)totpRequired.value=(await factor.json()).enabled===true;
  }catch(cause){
    if(cause.status===404){enabled.value=false;update.value=null;}
    else error.value=cause.message;
  }finally{checking.value=false;}
}
async function work(task,success){
  if(busy.value)return;
  busy.value=true;error.value='';message.value='';
  try{
    await task();
    message.value=success;
    await refresh();
  }catch(cause){error.value=cause.message;}
  finally{busy.value=false;}
}
function input(){
  return sha.value.trim()?{targetSha:sha.value.trim()}:{};
}
function check(){
  return work(async()=>{
    inspection.value=(await call('/api/actions/panel.update.check/execute',{input:input()})).result;
  },'检查完成；请确认以下完整提交身份');
}
function request(){
  return work(async()=>{
    const value=(await call('/api/actions/panel.update.request/execute',{input:input()})).result;
    sha.value='';
    inspection.value=null;
    message.value=value.status==='up_to_date'?'当前 SHA 已是目标版本':'更新申请已创建';
  },'申请已处理；若需部署，请核对并批准待处理提交');
}
// Web administrator may check a target and launch it with one explicit
// confirmation. Keep proposal + step-up + broker enqueue on the server,
// but do not require two separate buttons in the Web UI.
async function updateNow(){
  const candidate=inspection.value;
  if(busy.value || !enabled.value || update.value?.pending ||
     candidate?.status!=='update_available' || !candidate.targetSha ||
     !exactConfirmed.value || !password.value || (totpRequired.value && !code.value))return;
  busy.value=true;error.value='';message.value='';
  try{
    const proposal=(await call('/api/actions/panel.update.request/execute',{
      input:{targetSha:candidate.targetSha}
    })).result;
    if(proposal.status==='up_to_date'){
      message.value='目标已经是当前版本，无需更新';
      inspection.value=null;
    }else if(proposal.status==='approval_required' && proposal.id){
      // The actual update remains privileged, asynchronously verified by
      // the separately installed Broker. Never claim deployment succeeded.
      await call('/api/panel/update/approve',{
        id:proposal.id,currentPassword:password.value,code:code.value
      });
      message.value='已提交并批准这次更新，正在等待独立 Broker 执行；请查看执行结果';
      inspection.value=null;
    }else{
      throw new Error('未知更新申请响应');
    }
  }catch(cause){
    // A request might have been persisted before the approval error. Refresh
    // first, then show the failure without allowing refresh() to erase it.
    const details=cause.message;
    try {await refresh();}catch { /* keep the original error */ }
    error.value=details+'；如果申请已建立但审批失败，请查看下方待处理申请并重试审批。';
  }finally{
    password.value='';code.value='';exactConfirmed.value=false;
    busy.value=false;
    if(!error.value)await refresh();
  }
}
function cancel(){
  if(!update.value?.pending || update.value.pending.approved)return;
  const id=update.value.pending.id;
  return work(async()=>{
    await call('/api/panel/update/cancel',{id});
    exactConfirmed.value=false;
    password.value='';code.value='';
  },'未批准的更新申请已撤销');
}
function approve(){
  if(!exactConfirmed.value || !password.value || !update.value?.pending || update.value.pending.approved)return;
  const id=update.value.pending.id;
  return work(async()=>{
    try{
      await call('/api/panel/update/approve',{
        id,currentPassword:password.value,code:code.value
      });
      exactConfirmed.value=false;
    }finally{password.value='';code.value='';}
  },'更新已排队，独立 Broker 将执行验证；这不代表部署已成功');
}
onMounted(refresh);
</script>

<template>
  <section class="settings-section" aria-label="面板更新管理">
    <div class="section-heading">
      <h3>受控面板更新</h3>
      <button type="button" :disabled="busy || checking" @click="refresh">刷新状态</button>
    </div>
    <p class="muted small">平台级维护功能，不依赖 MCP 是否启用。所有检查和申请经由统一 ActionEngine；只有 Web 管理员可独立审批。TOTP 完全可选。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status" class="notice success-notice">{{ message }}</p>
    <p v-if="!enabled" class="notice">受限更新 Broker 尚未启用。仍可只读检查 Git 更新，但不能申请或执行部署；不可绕过旧版 systemd 隔离要求。</p>
    <!-- Render controls directly. A bare nested HTML <template> is inert. -->
      <label for="panel-target-sha">目标完整 Git SHA（可选）</label>
      <input id="panel-target-sha" v-model.trim="sha" :disabled="busy"
        maxlength="40" spellcheck="false" autocapitalize="off" autocomplete="off"
        placeholder="留空以查询 origin/main，私有仓库可填完整 SHA"/>
      <div class="toolbar">
        <button type="button" :disabled="busy || checking" @click="check">检查更新</button>
        <button type="button" class="primary" :disabled="!enabled || busy || checking || !!update?.pending" @click="request">申请更新</button>
      </div>
      <p v-if="inspection">
        检查结果：{{ inspection.status === 'up_to_date' ? '已经是目标版本' : '存在候选更新' }}
        <span v-if="inspection.source === 'supplied_sha'">（输入 SHA 未经远程认证，Broker 会进一步校验）</span>
      </p>
      <p v-if="inspection?.source === 'origin_main'" class="muted small">已查询当前配置的 origin/main；只有独立 Broker 验证其与预设可信仓库一致后才可部署。</p>
      <div v-if="inspection" class="update-sha-list">
        <div><strong>当前安装 SHA：</strong><code>{{ inspection.currentSha }}</code></div>
        <div><strong>候选目标 SHA：</strong><code>{{ inspection.targetSha }}</code></div>
      </div>
      <section v-if="inspection?.status==='update_available' && !update?.pending"
        class="settings-section" aria-label="Web 管理员立即更新">
        <h4>管理员直接更新</h4>
        <p class="muted small">确认上面显示的目标 SHA 后，可一次点击完成申请和审批，不必先点“申请更新”。后台仍校验 Web Session、CSRF、密码及可选 TOTP，并交给隔离 Broker 验证后执行。</p>
        <label class="refresh-choice">
          <input type="checkbox" v-model="exactConfirmed" :disabled="busy"/>
          我已核对完整目标 SHA，确认由受限 Broker 执行本次更新
        </label>
        <label for="direct-update-password">管理员密码</label>
        <input id="direct-update-password" type="password" v-model="password"
          autocomplete="current-password" :disabled="busy"/>
        <template v-if="totpRequired">
          <label for="direct-update-code">TOTP 验证码</label>
          <input id="direct-update-code" v-model.trim="code" autocomplete="one-time-code"
            :disabled="busy"/>
        </template>
        <button type="button" class="primary"
          :disabled="!enabled || busy || checking || !exactConfirmed || !password || (totpRequired && !code)"
          @click="updateNow">确认并立即更新</button>
        <p class="muted small">按钮仅触发部署队列，不代表已经更新成功；升级期间面板可能短暂断开，完成后请刷新状态。</p>
      </section>
      <template v-if="update?.pending">
        <h4>{{ update.pending.approved?'已批准，等待执行器处理':'待批准的更新申请' }}</h4>
        <div class="update-sha-list">
          <div><strong>当前提交：</strong><code>{{ update.pending.from }}</code></div>
          <div><strong>目标提交：</strong><code>{{ update.pending.target }}</code></div>
          <div><strong>申请 ID：</strong><code>{{ update.pending.id }}</code></div>
          <div><strong>到期时间：</strong>{{ update.pending.expiresAt }}</div>
        </div>
        <template v-if="!update.pending.approved">
          <label class="refresh-choice">
            <input type="checkbox" v-model="exactConfirmed"/>
            我已独立核对以上完整 SHA，确认执行此更新
          </label>
          <label for="approve-update-password">重新输入管理员密码</label>
          <input id="approve-update-password" type="password" v-model="password"
            autocomplete="current-password" />
          <template v-if="totpRequired">
            <label for="approve-update-code">新的 TOTP 验证码</label>
            <input id="approve-update-code" v-model.trim="code" autocomplete="one-time-code"/>
          </template>
          <p v-else class="muted small">未启用 TOTP：管理员密码是唯一的二次确认因素。</p>
          <div class="toolbar">
            <button type="button" class="primary" :disabled="!enabled || busy || checking || !password || !exactConfirmed || (totpRequired && !code)"
              @click="approve">独立批准并触发更新</button>
            <button type="button" :disabled="busy || checking" @click="cancel">撤销申请</button>
          </div>
        </template>
        <p v-else class="muted">已经批准的申请不能从 Web 撤销；请检查 Broker 状态和执行结果。</p>
      </template>
      <section v-if="update?.lastResult" class="settings-section">
        <h4>最近一次 Broker 结果</h4>
        <p>结果：<strong>{{ update.lastResult.status }}</strong> · {{ update.lastResult.at }}</p>
        <div class="update-sha-list"><div><strong>执行目标 SHA：</strong><code>{{ update.lastResult.sha }}</code></div>
          <div><strong>申请 ID：</strong><code>{{ update.lastResult.id }}</code></div></div>
        <p v-if="['failed','rolled_back'].includes(update.lastResult.status)" class="notice">
          更新失败或已回滚。请检查服务状态与 Broker 的 systemd 日志；不能将代码回滚视为服务已恢复。
        </p>
      </section>
  </section>
</template>
