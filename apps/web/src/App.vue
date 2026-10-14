<script setup>
import { onMounted, ref, computed } from 'vue';
import ResultRenderer from './components/ResultRenderer.vue';

const actions = ref([]);
const selected = ref('');
const inputText = ref('{}');
const response = ref(null);
const error = ref('');
const busy = ref(false);
const view = ref('visual');

const selectedAction = computed(() => actions.value.find(a => a.id === selected.value));

async function getJSON(url, options = {}) {
  const httpResponse = await fetch(url, options);
  const body = await httpResponse.json();
  if (!httpResponse.ok) throw new Error(body.error || `HTTP ${httpResponse.status}`);
  return body;
}

onMounted(async () => {
  try {
    const data = await getJSON('/api/actions');
    actions.value = data.actions;
    selected.value = data.actions[0]?.id || '';
  } catch (e) {
    error.value = `API 不可用：${e.message}`;
  }
});

function selectAction(id) {
  selected.value = id;
  inputText.value = '{}';
  response.value = null;
  error.value = '';
  view.value = 'visual';
}

async function run(operation) {
  busy.value = true;
  error.value = '';
  response.value = null;
  try {
    const input = JSON.parse(inputText.value);
    const content = await getJSON(`/api/actions/${encodeURIComponent(selected.value)}/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input })
    });
    response.value = { operation, content };
    view.value = operation === 'preview' ? 'json' : 'visual';
  } catch (e) {
    error.value = `操作失败：${e.message}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="layout">
    <header>
      <div class="eyebrow">LINUX PANEL / V0.2</div>
      <h1>可解释的 Linux 管理面板</h1>
      <p>结构化指标与共享 Action。当前仅供本地只读开发；MacBook 上获取的是本机信息，不是 VPS 的信息。</p>
    </header>

    <div class="columns">
      <aside>
        <div class="label">已注册 Action</div>
        <button v-for="action in actions" :key="action.id" class="action"
          :class="{ active: selected === action.id }" @click="selectAction(action.id)">
          <b>{{ action.title }}</b>
          <small>{{ action.id }} · {{ action.moduleId }}</small>
        </button>
      </aside>

      <section v-if="selectedAction">
        <div class="label">模块 / {{ selectedAction.moduleId }}</div>
        <h2>{{ selectedAction.title }}</h2>
        <p>{{ selectedAction.description }}</p>
        <div class="info"><strong>Linux 原理</strong><p>{{ selectedAction.explain }}</p></div>

        <label for="action-input">JSON 参数</label>
        <textarea id="action-input" v-model="inputText" spellcheck="false" rows="3"/>
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
          <ResultRenderer v-if="response.operation === 'execute' && view === 'visual'"
            :data="response.content.result" :presentation="selectedAction.presentation" />
          <pre v-else class="raw-output">{{ JSON.stringify(response.content, null, 2) }}</pre>
        </div>
        <div v-else-if="!error" class="empty-state">选择“查看操作计划”或“读取实时数据”。</div>
      </section>
      <section v-else><p>{{ error || '没有加载到 Action。请确认本地 API 已启动。' }}</p></section>
    </div>
    <footer>仅供本地学习。尚未提供身份验证、审计、远程 MCP、Shell 执行或写入型操作；禁止公网发布。</footer>
  </main>
</template>
