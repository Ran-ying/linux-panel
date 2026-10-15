<script setup>
import { onMounted, ref, computed } from 'vue';
import ActionCard from './components/ActionCard.vue';
import UpdateManager from './components/UpdateManager.vue';
import ListenerManager from './components/ListenerManager.vue';
import LoginPanel from './components/LoginPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import ThemeControl from './components/ThemeControl.vue';
import {version as panelVersion} from '../../../package.json';
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
const businessGroups = computed(() => moduleGroups.value.filter(group => group.id !== 'panel'));
const panelGroups = computed(() => moduleGroups.value.filter(group => group.id === 'panel'));
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
  <div v-if="!checking && !session" class="login-appearance"><ThemeControl /></div>
  <div v-if="checking" class="auth-shell" aria-busy="true"><span class="loading-indicator" role="status" aria-label="正在加载"></span></div>
  <LoginPanel v-else-if="!session" :initialized="initialized" @signed-in="signIn" />
  <main v-else class="layout">
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div class="columns">
      <aside class="module-sidebar">
        <div class="sidebar-brand">
          <div class="sidebar-heading"><h1>{{ settings.panelName || 'Linux Panel' }}</h1><span class="panel-version" aria-label="版本">v{{ panelVersion }}</span></div>
          <ThemeControl />
        </div>
        <div class="sidebar-modules">
          <div class="sidebar-group-label">功能模块</div>
        <nav class="module-nav" aria-label="业务模块">
          <button v-for="module in businessGroups" :key="module.id" type="button" class="module-toggle"
            :class="{ active: activePage === module.id }" @click="activePage=module.id">
            {{ module.name }}
          </button>
          <p v-if="!businessGroups.length" class="muted small">尚无业务模块</p>
        </nav>
        </div>
        <div class="sidebar-settings">
          <div class="sidebar-group-label">面板功能</div>
          <nav class="platform-nav" aria-label="面板功能">
            <button v-for="module in panelGroups" :key="module.id" type="button" class="module-toggle"
              :class="{ active: activePage === module.id }" @click="activePage=module.id">{{ module.name }}</button>
          </nav>
          <button type="button" class="module-toggle" :class="{ active: activePage === 'settings' }"
            @click="activePage='settings'">面板设置</button>
          <div class="sidebar-account">
            <span>{{ session.user.username }}</span>
            <button type="button" @click="logout">退出登录</button>
          </div>
        </div>
      </aside>
      <SettingsPanel v-if="activePage === 'settings'" :key="'settings'"
        :csrf="session.csrf" :user="session.user" :modules="moduleDefinitions"
        @signed-out="signOutLocally" @settings-changed="value=>settings=value" />
      <div v-else-if="activeGroup" :key="activeGroup.id" class="module-content">
        <div class="module-intro">
          <h2>{{ activeGroup.name }}</h2>
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
  </main>
</template>
