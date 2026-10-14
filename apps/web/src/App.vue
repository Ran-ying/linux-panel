<script setup>
import { onMounted, ref, computed } from 'vue';
import ActionCard from './components/ActionCard.vue';
import { buildModuleNavigation } from './module-navigation.js';

const moduleDefinitions = ref([]);
const actions = ref([]);
const presentations = ref({});
const activeModule = ref('');
const error = ref('');
const moduleGroups = computed(() => buildModuleNavigation(moduleDefinitions.value, actions.value));
const activeGroup = computed(() => moduleGroups.value.find(group => group.id === activeModule.value));

async function getJSON(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

onMounted(async () => {
  try {
    const [modulesResponse, actionsResponse, presentationsResponse] = await Promise.all([
      getJSON('/api/modules'),
      getJSON('/api/actions'),
      getJSON('/api/web/presentations')
    ]);
    moduleDefinitions.value = modulesResponse.modules;
    actions.value = actionsResponse.actions;
    presentations.value = Object.fromEntries(
      presentationsResponse.presentations.map(presentation => [presentation.actionId, presentation])
    );
    activeModule.value = moduleGroups.value[0]?.id ?? '';
  } catch (cause) {
    error.value = `API 不可用：${cause.message}`;
  }
});
</script>

<template>
  <main class="layout">
    <header>
      <div class="eyebrow">LINUX PANEL / V0.2</div>
      <h1>可解释的 Linux 管理面板</h1>
      <p>左侧选择功能模块；右侧按顺序展示模块的全部操作和实时数据。当前仅限本地只读使用。</p>
    </header>

    <div class="columns">
      <aside class="module-sidebar">
        <div class="label">功能模块</div>
        <nav class="module-nav" aria-label="功能模块">
          <button v-for="module in moduleGroups" :key="module.id" type="button"
            class="module-toggle" :class="{ active: activeModule === module.id }"
            :aria-current="activeModule === module.id ? 'page' : undefined"
            @click="activeModule = module.id">
            {{ module.name }}
          </button>
        </nav>
        <p v-if="!moduleGroups.length && !error" class="empty-actions">暂无可用模块</p>
      </aside>

      <div class="module-content" v-if="activeGroup" :key="activeGroup.id">
        <div class="module-intro">
          <div class="label">模块 / {{ activeGroup.id }}</div>
          <h2>{{ activeGroup.name }}</h2>
          <p>本模块共有 {{ activeGroup.actions.length }} 个可用操作，以下按顺序展示。</p>
        </div>
        <div v-if="activeGroup.actions.length" class="action-flow">
          <ActionCard v-for="action in activeGroup.actions" :key="action.id"
            :action="action" :presentation="presentations[action.id] ?? null" />
        </div>
        <section v-else class="empty-state">这个模块暂时没有对 Web 开放的 Action。</section>
      </div>
      <section v-else-if="error" role="alert">{{ error }}</section>
      <section v-else class="empty-state">请选择一个功能模块。</section>
    </div>

    <footer>本地只读原型。没有认证、远程 MCP、Shell 执行或写入能力；禁止公网部署。MacBook 上的数据来自 MacBook。</footer>
  </main>
</template>
