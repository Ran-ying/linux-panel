<script setup>
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
import ResultRenderer from './components/ResultRenderer.vue';
import { buildModuleNavigation } from './module-navigation.js';

const moduleDefinitions = ref([]);
const actions = ref([]);
const presentations = ref({});
const activeModule = ref('');
const selected = ref('');
const inputText = ref('{}');
const response = ref(null);
const error = ref('');
const busy = ref(false);
const view = ref('visual');
const autoRefresh = ref(false);

let refreshTimer;
let generation = 0;
const moduleGroups = computed(() => buildModuleNavigation(moduleDefinitions.value, actions.value));
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
    const [modulesResponse, actionResponse, webResponse] = await Promise.all([
      getJSON('/api/modules'),
      getJSON('/api/actions'),
      getJSON('/api/web/presentations')
    ]);
    moduleDefinitions.value = modulesResponse.modules;
    actions.value = actionResponse.actions;
    presentations.value = Object.fromEntries(webResponse.presentations.map(p => [p.actionId, p]));
    const first = moduleGroups.value[0];
    activeModule.value = first?.id ?? '';
    selected.value = first?.actions[0]?.id ?? '';
  } catch (e) {
    error.value = `API 不可用：${e.message}`;
  }
});

function selectAction(id) {
  if (selected.value === id) return;
  generation++;
  busy.value = false;
  autoRefresh.value = false;
  selected.value = id;
  inputText.value = '{}';
  response.value = null;
  error.value = '';
  view.value = 'visual';
}

function selectModule(id) {
  const module = moduleGroups.value.find(group => group.id === id);
  if (!module) return;
  activeModule.value = id;
  selectAction(module.actions[0]?.id ?? '');
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
      if (refresh) autoRefresh.value = false;
    }
  } finally {
    if (requestId === generation) busy.value = false;
  }
}

// Refresh cadence belongs to the Web UI, not an Action or the MCP adapter.
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
      <p>按模块浏览 Action。模块拥有能力，Web 负责展示和刷新策略；当前仅供本地只读开发。</p>
    </header>

    <div class="columns">
      <aside>
        <div class="label">功能模块</div>
        <nav class="module-nav" aria-label="功能模块和操作">
          <div v-for="module in moduleGroups" :key="module.id" class="module-group">
            <button type="button" class="module-toggle"
              :class="{ active: activeModule === module.id }"
              :aria-expanded="activeModule === module.id"
              :aria-controls="'actions-' + module.id"
              @click="selectModule(module.id)">
              <span class="module-heading">
                <strong>{{ module.name }}</strong>
                <span class="action-count">{{ module.actions.length }}</span>
              </span>
              <span class="module-subtitle">{{ module.id }} <span aria-hidden="true">{{ activeModule === module.id ? '▾' : '▸' }}</span></span>
            </button>
            <div v-show="activeModule === module.id" :id="'actions-' + module.id" class="module-action-list">
              <button v-for="action in module.actions" :key="action.id" type="button"
                class="action" :class="{ active: selected === action.id }"
                :aria-pressed="selected === action.id"
                @click="selectAction(action.id)">
                <span>{{ action.title }}</span>
                <small>{{ action.id }}</small>
              </button>
              <p v-if="!module.actions.length" class="empty-actions">此模块暂无 Web 操作</p>
            </div>
          </div>
        </nav>
        <p v-if="!moduleGroups.length && !error" class="empty-actions">暂无可用模块</p>
      </aside>

      <section v-if="selectedAction">
        <div class="label">模块 / {{ moduleGroups.find(m => m.id === activeModule)?.name ?? selectedAction.moduleId }}</div>
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
            <input type="checkbox" v-model="autoRefresh" />
            每 {{ refreshSeconds }} 秒自动刷新
            <span class="muted">（仅当前页面、默认关闭）</span>
          </label>
          <ResultRenderer v-if="response.operation === 'execute' && view === 'visual'"
            :data="response.content.result" :presentation="selectedPresentation" />
          <pre v-else class="raw-output">{{ JSON.stringify(response.content, null, 2) }}</pre>
        </div>
        <div v-else-if="!error" class="empty-state">选择“查看操作计划”或“读取实时数据”。</div>
      </section>
      <section v-else><p>{{ error || (moduleGroups.length ? '此模块暂无可用操作。' : '请检查本地 API 是否启动。') }}</p></section>
    </div>
    <footer>本地只读原型。没有认证、远程 MCP、Shell 执行或写入能力；禁止公网部署。MacBook 上的数据来自 MacBook。</footer>
  </main>
</template>
