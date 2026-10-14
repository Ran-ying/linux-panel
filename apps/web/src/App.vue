<script setup>
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
import ResultRenderer from './components/ResultRenderer.vue';

const actions = ref([]);
const presentations = ref({});
const selected = ref('');
const inputText = ref('{}');
const response = ref(null);
const error = ref('');
const busy = ref(false);
const view = ref('visual');
const autoRefresh = ref(false);

let refreshTimer;
let generation = 0;
const selectedAction = computed(() => actions.value.find(a => a.id === selected.value));
const selectedPresentation = computed(() => presentations.value[selected.value] ?? null);
const refreshSeconds = computed(() => (selectedPresentation.value?.refreshIntervalMs ?? 0) / 1000);

async function getJSON(url, options = {}) {
  const httpResponse = await fetch(url, options);
  const body = await httpResponse.json();
  if (!httpResponse.ok) throw new Error(body.error || `HTTP ${httpResponse.status}`);
  return body;
}

onMounted(async () => {
  try {
    const [actionResponse, webResponse] = await Promise.all([
      getJSON('/api/actions'),
      getJSON('/api/web/presentations')
    ]);
    actions.value = actionResponse.actions;
    presentations.value = Object.fromEntries(webResponse.presentations.map(p => [p.actionId, p]));
    selected.value = actionResponse.actions[0]?.id || '';
  } catch (e) {
    error.value = `API 不可用：${e.message}`;
  }
});

function selectAction(id) {
  generation++;
  busy.value = false;
  autoRefresh.value = false;
  selected.value = id;
  inputText.value = '{}';
  response.value = null;
  error.value = '';
  view.value = 'visual';
}

async function run(operation, refresh = false) {
  if (busy.value || !selected.value) return;
  const id = selected.value;
  const requestId = ++generation;
  busy.value = true;
  if (!refresh) {
    error.value = '';
    response.value = null;
    if (operation === 'preview') autoRefresh.value = false;
  }
  try {
    const input = JSON.parse(inputText.value);
    const content = await getJSON(`/api/actions/${encodeURIComponent(id)}/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input })
    });
    if (requestId !== generation || id !== selected.value) return;
    response.value = { operation, content };
    if (!refresh) view.value = operation === 'preview' ? 'json' : 'visual';
  } catch (e) {
    if (requestId === generation) {
      error.value = `操作失败：${e.message}`;
      // Disable further polling on invalid input or API failure.
      if (refresh) autoRefresh.value = false;
    }
  } finally {
    if (requestId === generation) busy.value = false;
  }
}

// Refresh policy belongs only to Web. Action.execute() is unaware of polling.
// Off by default, paused in hidden tabs, no overlapping requests.
watch([selected, selectedPresentation, autoRefresh], () => {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = undefined;
  const interval = selectedPresentation.value?.refreshIntervalMs ?? 0;
  if (!autoRefresh.value || !interval || interval < 3000) return;
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !busy.value &&
        response.value?.operation === 'execute') run('execute', true);
  }, interval);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  generation++;
});
</script>

<template>
  <main class="layout">
    <header>
      <div class="eyebrow">LINUX PANEL / V0.2</div>
      <h1>可解释的 Linux 管理面板</h1>
      <p>Action 仅定义能力和结构化结果；Web 单独决定界面、按钮及刷新节奏。当前为本地只读开发版本。</p>
    </header>

    <div class="columns">
      <aside>
        <div class="label">已注册 Action</div>
        <button v-for="action in actions" :key="action.id" class="action"
          :class="{ active: selected === action.id }" @click="selectAction(action.id)">
          <b>{{ action.title }}</b><small>{{ action.id }} · {{ action.moduleId }}</small>
        </button>
      </aside>

      <section v-if="selectedAction">
        <div class="label">模块 / {{ selectedAction.moduleId }}</div>
        <h2>{{ selectedAction.title }}</h2>
        <p>{{ selectedAction.description }}</p>
        <div class="info"><strong>底层机制</strong><p>{{ selectedAction.explain }}</p></div>

        <label for="action-input">JSON 参数</label>
        <textarea id="action-input" v-model="inputText" spellcheck="false" rows="3" />
        <div class="toolbar">
          <button :disabled="busy" @click="run('preview')">查看操作计划</button>
          <button :disabled="busy" class="primary" @click="run('execute')">读取实时数据</button>
        </div>

        <div v-if="error" role="alert" class="error">{{ error }}</div>
        <div v-if="response" class="result">
          <div class="result-header">
            <strong>{{ response.operation === 'preview' ? '操作计划' : '操作结果' }}</strong>
            <div v-if="response.operation === 'execute'" class="view-switch" aria-label="结果查看模式">
              <button :class="{ active: view === 'visual' }" @click="view='visual'">可视化</button>
              <button :class="{ active: view === 'json' }" @click="view='json'">原始 JSON</button>
            </div>
          </div>

          <label v-if="response.operation === 'execute' && refreshSeconds > 0" class="refresh-choice">
            <input type="checkbox" v-model="autoRefresh"/>
            每 {{ refreshSeconds }} 秒自动刷新
            <span class="muted">（仅当前页面、默认关闭）</span>
          </label>

          <ResultRenderer v-if="response.operation === 'execute' && view === 'visual'"
            :data="response.content.result" :presentation="selectedPresentation" />
          <pre v-else class="raw-output">{{ JSON.stringify(response.content, null, 2) }}</pre>
        </div>
        <div v-else-if="!error" class="empty-state">选择“查看操作计划”或“读取实时数据”。</div>
      </section>
      <section v-else><p>{{ error || '没有加载到 Action。请确认本地 API 已启动。' }}</p></section>
    </div>
    <footer>本地只读原型。没有认证、远程 MCP、Shell 执行或写入能力；禁止公网部署。MacBook 上的数据来自 MacBook。</footer>
  </main>
</template>
