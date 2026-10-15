<script setup>
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
import ResultRenderer from './ResultRenderer.vue';

const props = defineProps({
  action: { type: Object, required: true },
  presentation: { type: Object, default: null },
  csrf: { type: String, required: true }
});

const emit = defineEmits(['unauthorized']);
const inputText = ref('{}');
const response = ref(null);
const executionPlan = ref(null);
const error = ref('');
const busy = ref(false);
const view = ref('visual');
const autoRefresh = ref(false);
const refreshSeconds = computed(() => (props.presentation?.refreshIntervalMs ?? 0) / 1000);
const hasInputFields = computed(() => Object.keys(props.action.inputSchema?.properties ?? {}).length > 0);

let refreshTimer;
let controller;
let generation = 0;
let disposed = false;

async function run(operation, refresh = false) {
  // Each ActionCard owns its own execution state; unrelated cards stay usable.
  if (busy.value || disposed) return;
  const requestId = ++generation;
  busy.value = true;
  error.value = '';
  controller = new AbortController();
  try {
    const input = JSON.parse(inputText.value);
    const apiResponse = await fetch(
      `/api/actions/${encodeURIComponent(props.action.id)}/${operation}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Panel-CSRF': props.csrf },
        body: JSON.stringify({ input }),
        signal: controller.signal
      }
    );
    const payload = await apiResponse.json();
    if (apiResponse.status === 401) emit('unauthorized');
    if (!apiResponse.ok) throw new Error(payload.error || `HTTP ${apiResponse.status}`);
    if (disposed || generation !== requestId) return;
    if (operation === 'preview') executionPlan.value = payload;
    else {
      response.value = { operation, content: payload };
      if (!refresh) view.value = 'visual';
    }
  } catch (cause) {
    if (disposed || generation !== requestId || cause.name === 'AbortError') return;
    error.value = `操作失败：${cause.message}`;
    if (refresh) autoRefresh.value = false;
  } finally {
    if (!disposed && generation === requestId) {
      busy.value = false;
      controller = undefined;
    }
  }
}

function commandLine(step) {
  return [step.command, ...(step.args ?? [])].map(part => {
    const value = String(part);
    return /^[A-Za-z0-9_./:=,@%+-]+$/.test(value) ? value :
      "'" + value.split("'").join("'\"'\"'") + "'";
  }).join(' ');
}

function stepLabel(type) {
  return ({execFile:'执行命令', 'file-read':'读取文件', 'node-api':'系统 API', mock:'演示数据'})[type] ?? '操作步骤';
}

// These are Web-only invocation preferences, not part of Action or MCP.
watch([autoRefresh, refreshSeconds], () => {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = undefined;
  const interval = props.presentation?.refreshIntervalMs ?? 0;
  if (!autoRefresh.value || interval < 3000) return;
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !busy.value &&
        response.value?.operation === 'execute') void run('execute', true);
  }, interval);
});

onMounted(() => {
  // Only explicitly configured, parameter-free read Actions may auto-load.
  if (props.action.kind === 'read' && props.presentation?.loadOnEnter === true &&
      !(props.action.inputSchema?.required?.length) &&
      document.visibilityState === 'visible') {
    void run('execute');
  }
});

onUnmounted(() => {
  disposed = true;
  generation++;
  if (refreshTimer) clearInterval(refreshTimer);
  controller?.abort();
});
</script>

<template>
  <section class="action-card" :aria-label="action.title">
    <div class="card-heading">
      <div>
        <h3>{{ action.title }}</h3>
      </div>
      <span class="read-pill">{{ action.kind === 'read' ? '只读' : '需授权' }}</span>
    </div>

    <details class="action-explanation">
      <summary>操作详情</summary>
      <code>{{ action.id }}</code>
      <p>{{ action.description }}</p>
      <p>{{ action.explain }}</p>
    </details>

    <label v-if="hasInputFields" :for="'input-' + action.id">JSON 参数</label>
    <textarea v-if="hasInputFields" :id="'input-' + action.id" v-model="inputText"
      spellcheck="false" rows="3" />

    <div class="toolbar">
      <button type="button" :disabled="busy" @click="run('preview')">查看执行内容</button>
      <button type="button" class="primary" :disabled="busy" @click="run('execute')">
        {{ busy ? '处理中…' : action.kind === 'write' ? '申请更新' : '刷新数据' }}
      </button>
    </div>

    <div v-if="executionPlan" class="execution-plan">
      <div class="section-heading"><strong>执行内容</strong>
        <button type="button" class="form-button" @click="executionPlan=null">收起详情</button>
      </div>
      <p class="muted small">以下为此操作的实现步骤；查看不会执行操作。</p>
      <ol>
        <li v-for="(step,index) in executionPlan.steps" :key="index">
          <strong>{{ stepLabel(step.type) }}</strong>
          <pre v-if="step.command" class="raw-output command-output">{{ commandLine(step) }}</pre>
          <p v-if="step.path">文件：<code>{{ step.path }}</code></p>
          <p v-if="step.description">{{ step.description }}</p>
        </li>
      </ol>
      <details><summary>原始步骤 JSON</summary><pre class="raw-output">{{ JSON.stringify(executionPlan, null, 2) }}</pre></details>
    </div>
    <div v-if="error" role="alert" class="error">{{ error }}</div>
    <div v-if="response" class="result">
      <div class="result-header">
        <strong>{{ response.operation === 'preview' ? '操作计划' : '操作结果' }}</strong>
        <div v-if="response.operation === 'execute'" class="view-switch" aria-label="结果查看模式">
          <button type="button" :class="{ active: view === 'visual' }" @click="view='visual'">可视化</button>
          <button type="button" :class="{ active: view === 'json' }" @click="view='json'">原始 JSON</button>
        </div>
      </div>
      <label v-if="response.operation === 'execute' && refreshSeconds > 0" class="refresh-choice">
        <input type="checkbox" v-model="autoRefresh" />
        每 {{ refreshSeconds }} 秒自动刷新
        <span class="muted">（默认关闭）</span>
      </label>
      <ResultRenderer v-if="response.operation === 'execute' && view === 'visual'"
        :data="response.content.result" :presentation="presentation" />
      <pre v-else class="raw-output">{{ JSON.stringify(response.content, null, 2) }}</pre>
    </div>
    <p v-else-if="busy && !error" class="empty-state" role="status">正在读取实时数据…</p>
    <p v-else-if="!error" class="empty-state">{{ action.kind === 'write' ? '此操作只生成待批准的更新申请，不会立即部署。' : '尚未读取数据，可点击“刷新数据”。' }}</p>
  </section>
</template>
