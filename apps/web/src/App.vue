<script setup>
import { onMounted, ref, computed, inject } from 'vue';
import ActionCard from './components/ActionCard.vue';
import UpdateManager from './components/UpdateManager.vue';
import ListenerManager from './components/ListenerManager.vue';
import LoginPanel from './components/LoginPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { buildModuleNavigation } from './module-navigation.js';

const themeController = inject('themeController');
const themePreference = ref(themeController?.getPreference() ?? 'system');
function onThemeChange(event) {
  themePreference.value = themeController?.setPreference(event.target.value) ?? 'system';
}

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

function authRedirect() {
  const next = new URLSearchParams(window.location.search).get('next');
  // Only local authorization paths are permitted. No open redirects.
  if (next && next.startsWith('/oauth/authorize?') &&
      next.length < 4096 && !next.startsWith('//')) {
    window.location.assign(next);
    return true;
  }
  return false;
}

async function signIn(payload) {
  session.value = payload;
  if (authRedirect()) return;
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
      if (session.value && !authRedirect()) await loadDashboard();
    }
  } catch (cause) { error.value = cause.message; }
  finally { checking.value = false; }
});
</script>

<template>
  <div class="appearance-control">
    <label for="appearance-choice">外观</label>
    <select id="appearance-choice" :value="themePreference" aria-label="界面外观"
      @change="onThemeChange">
      <option value="system">跟随系统</option>
      <option value="light">浅色</option>
      <option value="dark">深色</option>
    </select>
  </div>
  <div v-if="checking" class="auth-shell"><p role="status">正在检查登录状态…</p></div>
  <LoginPanel v-else-if="!session" :initialized="initialized" @signed-in="signIn" />
  <main v-else class="layout">
    <header>
      <div class="eyebrow">LINUX PANEL / V0.5</div>
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
        <UpdateManager v-if="activeGroup.id === 'panel'" :csrf="session.csrf"
          @unauthorized="signOutLocally" />
        <ListenerManager v-if="activeGroup.id === 'panel'" :csrf="session.csrf"
          @unauthorized="signOutLocally" />
        <div v-if="activeGroup.actions.some(a => activeGroup.id !== 'panel' || !a.id.startsWith('panel.update.') && !a.id.startsWith('panel.listener.'))"
          class="action-flow">
          <ActionCard v-for="action in activeGroup.actions.filter(a => activeGroup.id !== 'panel' || !a.id.startsWith('panel.update.') && !a.id.startsWith('panel.listener.'))"
            :key="action.id" :action="action" :presentation="presentations[action.id] ?? null"
            :csrf="session.csrf" @unauthorized="signOutLocally" />
        </div>
        <section v-else-if="activeGroup.id !== 'panel'" class="empty-state">这个模块暂时没有对 Web 开放的 Action。</section>
      </div>
    </div>
    <footer>v0.5：TOTP 可选，MCP 和更新权限默认关闭；启用可信客户端直接更新后，无需每次 Web 审批。</footer>
  </main>
</template>
