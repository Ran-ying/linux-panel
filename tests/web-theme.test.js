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
test('both themes and a pre-login accessible selector exist in the app and styles',()=>{
 const css=readFileSync(new URL('../apps/web/src/style.css',import.meta.url),'utf8');
 const app=readFileSync(new URL('../apps/web/src/App.vue',import.meta.url),'utf8');
 const main=readFileSync(new URL('../apps/web/src/main.js',import.meta.url),'utf8');
 assert.match(css,/:root\[data-theme="dark"\]/);
 assert.match(css,/--page-bg/);
 assert.match(css,/--panel-bg/);
 assert.match(css,/--focus-ring/);
 assert.match(css,/\.appearance-control select:focus-visible/);
 assert.match(app,/<select id="appearance-choice"/);
 assert.match(app,/<option value="system">跟随系统<\/option>/);
 assert.match(app,/<option value="light">浅色<\/option>/);
 assert.match(app,/<option value="dark">深色<\/option>/);
 assert.ok(app.indexOf('class="appearance-control"') < app.indexOf('v-if="checking"'),
   'theme selector must be rendered before login and on the dashboard');
 assert.ok(main.indexOf('createThemeController(') < main.indexOf('.mount('),
   'theme must be applied before Vue mounts');
});
