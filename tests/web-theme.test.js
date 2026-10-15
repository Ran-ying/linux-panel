import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  THEME_STORAGE_KEY, normalizeThemePreference, resolveTheme, createThemeController
} from '../apps/web/src/theme.js';

function harness({stored,systemDark=false,blockedStorage=false}={}){
  const attributes = {};
  const root = {style:{},setAttribute(name,value){attributes[name]=value;}};
  const values = new Map();
  if(stored !== undefined) values.set(THEME_STORAGE_KEY,stored);
  const storage = {
    getItem(key){if(blockedStorage)throw Error('Storage denied');return values.get(key)??null;},
    setItem(key,value){if(blockedStorage)throw Error('Storage denied');values.set(key,value);}
  };
  const listeners = new Set();
  const mediaQuery = {
    matches:systemDark,
    addEventListener(type,listener){assert.equal(type,'change');listeners.add(listener);},
    removeEventListener(type,listener){assert.equal(type,'change');listeners.delete(listener);}
  };
  const controller=createThemeController({root,getStorage:()=>storage,mediaQuery});
  return {controller,attributes,root,values,mediaQuery,systemChange(isDark){
    mediaQuery.matches=isDark;
    for(const listener of listeners)listener();
  },listeners};
}
test('strictly recognize system, light and dark; reject unknown persistent values',()=>{
 for(const value of ['system','light','dark'])assert.equal(normalizeThemePreference(value),value);
 for(const value of ['DARK','solarized',null,undefined,'__proto__'])
  assert.equal(normalizeThemePreference(value),'system');
 assert.equal(resolveTheme('system',true),'dark');
 assert.equal(resolveTheme('system',false),'light');
 assert.equal(resolveTheme('light',true),'light');
 assert.equal(resolveTheme('dark',false),'dark');
});
test('follow OS theme at first render and when system changes',()=>{
 const h=harness({systemDark:true});
 assert.equal(h.controller.getPreference(),'system');
 assert.equal(h.attributes['data-theme'],'dark');
 assert.equal(h.root.style.colorScheme,'dark');
 h.systemChange(false);
 assert.equal(h.attributes['data-theme'],'light');
 h.controller.dispose();
 assert.equal(h.listeners.size,0);
});
test('explicit preference survives a reload and does not change with OS',()=>{
 const h=harness({systemDark:false});
 assert.equal(h.controller.setPreference('dark'),'dark');
 assert.equal(h.values.get(THEME_STORAGE_KEY),'dark');
 h.systemChange(true);
 h.systemChange(false);
 assert.equal(h.attributes['data-theme'],'dark');
 const reopened=harness({stored:h.values.get(THEME_STORAGE_KEY),systemDark:false});
 assert.equal(reopened.controller.getEffectiveTheme(),'dark');
 assert.equal(reopened.attributes['data-theme'],'dark');
});
test('inaccessible browser storage does not prevent rendering or switching',()=>{
 const h=harness({blockedStorage:true,systemDark:false});
 assert.equal(h.attributes['data-theme'],'light');
 h.controller.setPreference('dark');
 assert.equal(h.attributes['data-theme'],'dark');
 h.controller.setPreference('invalid');
 assert.equal(h.attributes['data-theme'],'light');
});
test('both palettes and shared accessible theme controls exist before and after login',()=>{
 const css=readFileSync(new URL('../apps/web/src/style.css',import.meta.url),'utf8');
 const app=readFileSync(new URL('../apps/web/src/App.vue',import.meta.url),'utf8');
 const control=readFileSync(new URL('../apps/web/src/components/ThemeControl.vue',import.meta.url),'utf8');
 const main=readFileSync(new URL('../apps/web/src/main.js',import.meta.url),'utf8');
 assert.match(css,/:root\[data-theme="dark"\]/);
 assert.match(css,/--focus-ring/);
 assert.doesNotMatch(control,/type="checkbox"/);
 assert.doesNotMatch(control,/:disabled/);
 assert.match(control,/aria-label="自动"/);
 assert.match(control,/>Auto<\/button>/);
 assert.match(control,/aria-label="深色"/);
 assert.match(control,/aria-label="浅色"/);
 assert.match(app,/class="login-appearance"><ThemeControl/);
 assert.match(app,/class="sidebar-brand"[\s\S]*?<ThemeControl/);
 assert.ok(main.indexOf('createThemeController(') < main.indexOf('.mount('));
});
