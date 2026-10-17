import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const src=resolve(dirname(fileURLToPath(import.meta.url)),'../apps/web/src');
const css=readFileSync(resolve(src,'style.css'),'utf8');
const components=readdirSync(resolve(src,'components')).filter(name=>name.endsWith('.vue'));
const read=name=>readFileSync(resolve(src,'components',name),'utf8');
const style=name=>read(name).match(/<style\b[^>]*>([\s\S]*?)<\/style>/)?.[1]||'';

test('all Vue component CSS uses theme palette without fallback colors',()=>{
 assert.ok(components.length>=15);
 for(const name of components){
  assert.doesNotMatch(style(name),/#[0-9a-fA-F]{3,8}\b/,name);
  assert.doesNotMatch(style(name),/\bCanvas\b|var\(--(?:accent|border|surface)(?:,|\))/,name);
 }
});
test('central layout, input, control, dialog and terminal tokens',()=>{
 for(const token of ['ui-card-radius','ui-shell-radius','ui-input-radius','ui-pill-radius',
  'ui-control-height','ui-field-height','ui-control-font-size','ui-control-font-weight',
  'ui-label-font-weight','ui-value-font-weight','ui-card-padding','ui-dialog-padding',
  'ui-dialog-backdrop','ui-dialog-shadow','ui-terminal-background']){
  assert.match(css,new RegExp('--'+token+':\\s*[^;]+;'),token);
 }
 assert.match(css,/:root\[data-theme="dark"\]/);
 assert.match(css,/:where\(\.task-form,\.config-form\)[\s\S]*?font-weight:var\(--ui-value-font-weight\)/);
});
test('all module confirmation dialogs share themed background and backdrop',()=>{
 for(const [name,selector] of [
  ['ManagedConfigs.vue','config-dialog'],['ScheduledTasks.vue','task-dialog'],
  ['V2RayManager.vue','v2ray-dialog'],['NginxService.vue','nginx-control-dialog'],
  ['NginxCertificates.vue','nginx-certificate-dialog']]){
  const declaration=style(name).match(new RegExp('\\.'+selector+'\\{([^}]+)\\}'))?.[1]||'';
  for(const required of ['background:var(--panel-bg)','border-radius:var(--ui-card-radius)',
   'padding:var(--ui-dialog-padding)','box-shadow:var(--ui-dialog-shadow)']){
   assert.ok(declaration.includes(required),name+': '+required);
  }
  assert.ok(style(name).includes('.'+selector+'::backdrop{background:var(--ui-dialog-backdrop)}'),name);
 }
 assert.match(css,/\.file-action-dialog::backdrop\{background:var\(--ui-dialog-backdrop\)\}/);
});
test('intentional Nginx text links, flat cards and V2Ray navigation survive',()=>{
 assert.match(style('ManagedConfigs.vue'),/\.config-site-text-action\{[^}]*text-decoration:underline/);
 assert.match(style('ManagedConfigs.vue'),/\.config-site-text-action\{[^}]*font-weight:var\(--ui-value-font-weight\)/);
 assert.match(style('ScheduledTasks.vue'),/\.scheduled-tasks\{[^}]*background:transparent/);
 assert.match(style('V2RayManager.vue'),/\.v2ray-config-nav\{[^}]*background:transparent/);
 assert.match(css,/\.action-card\.flat-action\{[^}]*background:transparent/);
});
test('dialog input values do not inherit their bold labels',()=>{
 for(const name of ['ManagedConfigs.vue','ScheduledTasks.vue']){
  assert.match(style(name),/label input[^}]*font-weight:var\(--ui-value-font-weight\)/,name);
 }
});
