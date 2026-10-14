<script setup>
import { onMounted, ref, computed } from 'vue';
import ActionCard from './components/ActionCard.vue';
import LoginPanel from './components/LoginPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { buildModuleNavigation } from './module-navigation.js';

const initialized = ref(false);
const checking = ref(true);
const session = ref(null);
const moduleDefinitions = ref([]);
const actions = ref([]);
const presentations = ref({});
const settings = ref({ panelName: 'Linux Panel' });
const activePage = ref('settings');
const error = ref('');

const moduleGroups = computed(() => buildModuleNavigation(moduleDefinitions.value, actions.value));
const activeGroup = computed(() => moduleGroups.value.find(group => group.id === activePage.value));

async function getJSON(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { status: response.status });
  return payload;
}

async function loadDashboard() {
  try {
    const [modulesResponse, actionsResponse, presentationsResponse, cfg] = await Promise.all([
      getJSON('/api/modules'), getJSON('/api/actions'),
      getJSON('/api/web/presentations'), getJSON('/api/panel/settings')
    ]);
    moduleDefinitions.value = modulesResponse.modules;
    actions.value = actionsResponse.actions;
    presentations.value = Object.fromEntries(presentationsResponse.presentations.map(p => [p.actionId, p]));
    settings.value = cfg.settings;
    activePage.value = moduleGroups.value[0]?.id ?? 'settings';
  } catch (cause) {
    if (cause.status === 401) signOutLocally();
    else error.value = `加载失败：${cause.message}`;
  }
}

function signOutLocally() {
  session.value = null;
  moduleDefinitions.value = [];
  actions.value = [];
  activePage.value = 'settings';
}

async function signIn(payload) {
  session.value = payload;
  error.value = '';
  await loadDashboard();
}

async function logout() {
  if (!session.value) return;
  error.value = '';
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST', headers: { 'X-Panel-CSRF': session.value.csrf }
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    signOutLocally();
  } catch (cause) {
    // Never claim the user was logged out if server-side revocation failed.
    error.value = `退出登录失败：${cause.message}`;
  }
}

onMounted(async () => {
  try {
    const status = await getJSON('/api/auth/status');
    initialized.value = status.initialized;
    if (initialized.value) {
      try { session.value = await getJSON('/api/auth/session'); }
      catch (cause) { if (cause.status !== 401) throw cause; }
      if (session.value) await loadDashboard();
    }
  } catch (cause) { error.value = cause.message; }
  finally { checking.value = false; }
});
</script>

<template>
  <div v-if="checking" class="auth-shell"><p role="status">正在检查登录状态…</p></div>
  <LoginPanel v-else-if="!session" :initialized="initialized" @signed-in="signIn" />
  <main v-else class="layout">
    <header>
      <div class="eyebrow">LINUX PANEL / V0.4</div>
      <div class="header-row">
        <h1>{{ settings.panelName || 'Linux Panel' }}</h1>
        <div class="account-area">
          <span>{{ session.user.username }}</span>
          <button type="button" @click="logout">退出登录</button>
        </div>
      </div>
      <p>登录后才能查看模块和调用 Action。身份、权限与面板设置属于内置平台功能。</p>
    </header>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div class="columns">
      <aside class="module-sidebar">
        <div class="label">功能模块</div>
        <nav class="module-nav" aria-label="业务模块">
          <button v-for="module in moduleGroups" :key="module.id" type="button" class="module-toggle"
            :class="{ active: activePage === module.id }" @click="activePage=module.id">
            {{ module.name }}
          </button>
          <p v-if="!moduleGroups.length" class="muted small">尚无业务模块</p>
        </nav>
        <div class="sidebar-settings">
          <div class="label">平台</div>
          <button type="button" class="module-toggle" :class="{ active: activePage === 'settings' }"
            @click="activePage='settings'">面板设置</button>
        </div>
      </aside>
      <SettingsPanel v-if="activePage === 'settings'" :key="'settings'"
        :csrf="session.csrf" :user="session.user" :modules="moduleDefinitions"
        @signed-out="signOutLocally" @settings-changed="value=>settings=value" />
      <div v-else-if="activeGroup" :key="activeGroup.id" class="module-content">
        <div class="module-intro">
          <div class="label">模块 / {{ activeGroup.id }}</div>
          <h2>{{ activeGroup.name }}</h2>
          <p>本模块共有 {{ activeGroup.actions.length }} 个可用操作，以下按顺序展示。</p>
        </div>
        <div v-if="activeGroup.actions.length" class="action-flow">
          <ActionCard v-for="action in activeGroup.actions" :key="action.id"
            :action="action" :presentation="presentations[action.id] ?? null"
            :csrf="session.csrf" @unauthorized="signOutLocally" />
        </div>
        <section v-else class="empty-state">这个模块暂时没有对 Web 开放的 Action。</section>
      </div>
    </div>
    <footer>v0.4 开发阶段：MCP 扩展默认关闭。OAuth 完成前，MCP 拒绝所有客户端访问。</footer>
  </main>
</template>
