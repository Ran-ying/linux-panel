<script setup>
import { onMounted, ref, computed } from 'vue';

const actions = ref([]);
const selected = ref('');
const inputText = ref('{}');
const output = ref('尚未执行');
const busy = ref(false);
const selectedAction = computed(() => actions.value.find(a => a.id === selected.value));

async function getJSON(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

onMounted(async () => {
  try {
    const data = await getJSON('/api/actions');
    actions.value = data.actions;
    selected.value = data.actions[0]?.id || '';
  } catch (e) { output.value = `API 不可用：${e.message}`; }
});

async function run(kind) {
  busy.value = true;
  try {
    const input = JSON.parse(inputText.value);
    const result = await getJSON(`/api/actions/${encodeURIComponent(selected.value)}/${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input })
    });
    output.value = JSON.stringify(result, null, 2);
  } catch (error) {
    output.value = `操作失败：${error.message}`;
  } finally { busy.value = false; }
}
</script>

<template>
  <main class="layout">
    <header>
      <div class="eyebrow">LINUX PANEL / V0.1</div>
      <h1>可解释的 Linux 管理面板</h1>
      <p>本地、只读原型。每个 Action 由自己的模块注册，Web 读取共享注册表；MCP 适配器将在权限系统完成后接入。</p>
    </header>
    <div class="columns">
      <aside>
        <div class="label">已注册 Action</div>
        <button v-for="a in actions" :key="a.id" class="action" :class="{active:selected===a.id}" @click="selected=a.id;inputText='{}';output='尚未执行'">
          <b>{{a.title}}</b><small>{{a.id}} · {{a.moduleId}}</small>
        </button>
      </aside>
      <section v-if="selectedAction">
        <div class="label">模块 / {{selectedAction.moduleId}}</div>
        <h2>{{selectedAction.title}}</h2>
        <p>{{selectedAction.description}}</p>
        <div class="info"><strong>底层机制</strong><p>{{selectedAction.explain}}</p></div>
        <label for="input">JSON 参数</label>
        <textarea id="input" v-model="inputText" spellcheck="false" rows="3"/>
        <div class="toolbar">
          <button :disabled="busy" @click="run('preview')">查看操作计划</button>
          <button :disabled="busy" class="primary" @click="run('execute')">执行只读操作</button>
        </div>
        <label>结果 / 原始输出</label>
        <pre>{{output}}</pre>
      </section>
      <section v-else><p>没有加载到 Action。请确认本地 API 已启动。</p></section>
    </div>
    <footer>仅供本地学习与架构验证。暂不提供登录、远程 MCP、Shell 执行或服务器修改能力。</footer>
  </main>
</template>
