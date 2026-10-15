<script setup>
import {inject,onMounted,onUnmounted,ref} from 'vue';
const controller=inject('themeController');
const preference=ref(controller?.getPreference() ?? 'system');
const effective=ref(controller?.getEffectiveTheme() ?? 'light');
let media;
function sync(){effective.value=controller?.getEffectiveTheme() ?? 'light';}
function choose(value){
  preference.value=controller?.setPreference(value) ?? value;
  sync();
}
function follow(event){choose(event.target.checked ? 'system' : effective.value);}
onMounted(()=>{
  media=window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change',sync);
});
onUnmounted(()=>media?.removeEventListener?.('change',sync));
</script>

<template>
  <div class="appearance-control">
    <label class="follow-system">
      <input type="checkbox" :checked="preference === 'system'" @change="follow" />
      跟随系统
    </label>
    <fieldset class="theme-capsule" :disabled="preference === 'system'" aria-label="界面外观">
      <button type="button" aria-label="深色" :aria-pressed="effective === 'dark'" @click="choose('dark')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/></svg>
      </button>
      <button type="button" aria-label="浅色" :aria-pressed="effective === 'light'" @click="choose('light')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>
      </button>
    </fieldset>
  </div>
</template>
