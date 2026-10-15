import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { createThemeController } from './theme.js';

const themeController = createThemeController({
  root: document.documentElement,
  getStorage: () => window.localStorage,
  mediaQuery: window.matchMedia?.('(prefers-color-scheme: dark)')
});

createApp(App).provide('themeController', themeController).mount('#app');
