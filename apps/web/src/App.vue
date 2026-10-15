<script setup>
import { onMounted, onBeforeUnmount, watch, nextTick, ref, computed } from 'vue';
import ActionCard from './components/ActionCard.vue';
import UpdateManager from './components/UpdateManager.vue';
import ListenerManager from './components/ListenerManager.vue';
import LoginPanel from './components/LoginPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import ThemeControl from './components/ThemeControl.vue';
import {version as panelVersion} from '../../../package.json';
import { buildModuleNavigation } from './module-navigation.js';

const initialized = ref(true);
const checking = ref(true);
const session = ref(null);
const moduleDefinitions = ref([]);
const actions = ref([]);
const presentations = ref({});
const settings = ref({ panelName: 'Linux Panel' });
const activePage = ref('settings');
const error = ref('');
const mobileExpanded = ref(false);
const mobileTab = ref('modules');
const sidebarBrand = ref(null);
const sidebarTabs = ref(null);
const sidebarToggle = ref(null);
const mobileHeaderHeight = ref(180);
let headerObserver;

watch([sidebarBrand, sidebarTabs, sidebarToggle], nodes => {
  headerObserver?.disconnect();
  if (!nodes.every(Boolean)) return;
  const measure = () => {
    mobileHeaderHeight.value = Math.ceil(nodes.reduce((height, node) =>
      height + node.getBoundingClientRect().height, 2));
  };
  headerObserver = new ResizeObserver(measure);
  nodes.forEach(node => headerObserver.observe(node));
  measure();
}, { flush: 'post' });
onBeforeUnmount(() => headerObserver?.disconnect());

async function chooseTab(tab, focus = false) {
  mobileTab.value = tab;
  mobileExpanded.value = true;
  if (focus) {
    await nextTick();
    sidebarTabs.value?.querySelector('[aria-selected="true"]')?.focus();
  }
}

function collapseNavigation() {
  mobileExpanded.value = false;
  sidebarToggle.value?.focus();
}

async function selectPage(id) {
  activePage.value = id;
  mobileExpanded.value = false;
  if (window.matchMedia('(max-width:730px)').matches) {
    await nextTick();
    sidebarToggle.value?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
}

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
  mobileExpanded.value = false;
  mobileTab.value = 'modules';
  moduleDefinitions.value = [];
  actions.value = [];
  presentations.value = {};
  settings.value = { panelName: 'Linux Panel' };
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
    session.value = await getJSON('/api/auth/session');
    if (!authRedirect()) await loadDashboard();
  } catch (cause) {
    if (cause.status === 401) {
      signOutLocally();
      try { initialized.value = (await getJSON('/api/auth/status')).initialized; }
      catch (statusError) { error.value = statusError.message; }
    } else error.value = cause.message;
  } finally { checking.value = false; }
});
</script>

<template>
  <div v-if="!checking && !session" class="login-appearance"><ThemeControl /></div>
  <LoginPanel v-if="!checking && !session" :initialized="initialized" @signed-in="signIn" />
  <main v-else class="layout" :aria-busy="checking">
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div class="columns">
      <div class="sidebar-slot" :style="{ '--mobile-header-height': mobileHeaderHeight + 'px' }">
      <aside class="module-sidebar" :class="{ 'is-expanded': mobileExpanded, 'is-panel-tab': mobileTab === 'panel' }"
        @keydown.esc="collapseNavigation">
        <div ref="sidebarBrand" class="sidebar-brand">
          <div class="sidebar-heading"><h1>{{ settings.panelName || 'Linux Panel' }}</h1><span class="panel-version" aria-label="版本">v{{ panelVersion }}</span></div>
          <ThemeControl />
        </div>
        <div ref="sidebarTabs" class="sidebar-tabs" role="tablist" aria-label="导航分类"
          @keydown.left.prevent="chooseTab('modules', true)" @keydown.right.prevent="chooseTab('panel', true)">
          <button id="modules-tab" type="button" role="tab" :aria-selected="mobileTab === 'modules'"
            :tabindex="mobileTab === 'modules' ? 0 : -1" aria-controls="business-navigation"
            @click="chooseTab('modules')">功能模块</button>
          <button id="panel-tab" type="button" role="tab" :aria-selected="mobileTab === 'panel'"
            :tabindex="mobileTab === 'panel' ? 0 : -1" aria-controls="panel-navigation"
            @click="chooseTab('panel')">面板功能</button>
        </div>
        <div id="sidebar-navigation" class="sidebar-navigation">
        <div id="business-navigation" class="sidebar-modules">
          <div class="sidebar-group-label">功能模块</div>
        <nav class="module-nav" aria-label="业务模块">
          <button v-for="module in businessGroups" :key="module.id" type="button" class="module-toggle"
            :class="{ active: activePage === module.id }" @click="selectPage(module.id)">
            {{ module.name }}
          </button>
          <div v-if="checking" class="sidebar-placeholder" aria-hidden="true"><span v-for="n in 3" :key="n" class="skeleton-line"></span></div>
          <p v-else-if="!businessGroups.length" class="muted small">尚无业务模块</p>
        </nav>
        </div>
        <div id="panel-navigation" class="sidebar-settings">
          <div class="sidebar-group-label">面板功能</div>
          <nav class="platform-nav" aria-label="面板功能">
            <button v-for="module in panelGroups" :key="module.id" type="button" class="module-toggle"
              :class="{ active: activePage === module.id }" @click="activePage=module.id">{{ module.name }}</button>
          </nav>
          <button type="button" class="module-toggle" :class="{ active: activePage === 'settings' }"
            @click="selectPage('settings')" :disabled="checking">面板设置</button>
          <div v-if="session && !checking" class="sidebar-account">
            <span>{{ session.user.username }}</span>
            <button type="button" @click="logout">退出登录</button>
          </div>
        </div>
        </div>
        <button ref="sidebarToggle" type="button" class="sidebar-collapse" :aria-expanded="mobileExpanded"
          aria-controls="sidebar-navigation" @click="mobileExpanded ? collapseNavigation() : chooseTab(mobileTab)">
          {{ mobileExpanded ? '收起' : '展开导航' }}
        </button>
      </aside>
      </div>
      <div v-if="checking" class="module-content dashboard-placeholder" aria-label="主界面加载中">
        <div class="module-intro"><h2>系统概览</h2></div>
        <section v-for="n in 3" :key="n" class="action-card" aria-hidden="true">
          <span class="skeleton-line skeleton-title"></span>
          <span class="skeleton-line"></span>
          <span class="skeleton-line skeleton-short"></span>
        </section>
      </div>
      <SettingsPanel v-else-if="session && activePage === 'settings'" :key="'settings'"
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
