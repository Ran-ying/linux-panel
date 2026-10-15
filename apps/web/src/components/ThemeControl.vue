<script setup>
import {inject,ref} from 'vue';
const controller=inject('themeController');
const preference=ref(controller?.getPreference() ?? 'system');
function choose(value){
  preference.value=controller?.setPreference(value) ?? value;
}
</script>

<template>
  <div class="appearance-control">
    <fieldset class="theme-capsule" aria-label="界面外观">
      <button type="button" aria-label="浅色" :aria-pressed="preference === 'light'" @click="choose('light')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>
      </button>
      <button type="button" class="theme-auto" aria-label="自动" title="自动跟随系统"
        :aria-pressed="preference === 'system'" @click="choose('system')">Auto</button>
      <button type="button" aria-label="深色" :aria-pressed="preference === 'dark'" @click="choose('dark')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/></svg>
      </button>
    </fieldset>
  </div>
</template>
